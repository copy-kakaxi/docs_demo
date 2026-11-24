# 基于风险指针（Hazard Pointers）实现无锁并发栈

## 简介

术语“风险指针”（Hazard Pointer）是由 Maged Michael 发明的一种无锁内存回收技术（曾被 IBM 申请为专利）。

在上一篇无锁栈的实现中，我们通过**原子计数器 + 延迟删除链表**来回收节点，但该方案存在一个明显的隐患：**如果高并发下源源不断地有线程执行 `pop()`，导致活跃线程数永远无法降为 0，待删除链表中的节点就会无限堆积、永远无法被回收**。

为了彻底打破这种回收饥饿，我们需要换一种更加精细化的思路——**风险指针（Hazard Pointers）**：
- 不再粗粒度地统计“有多少个线程在 `pop`”，而是**精确登记“每个线程当前正在访问哪一个具体节点”**。
- 当某个线程准备访问某个节点前，先将该节点的内存地址写入全局公开的“风险指针数组”中，向所有其他线程宣告：“**我正在使用这个节点，你们谁都别把它 `delete` 掉！**”
- 当一个节点被弹出后，只要全局风险指针数组中**没有任何指针指向它**，就可以立刻安全释放；否则暂存进待删链表，等后续没有风险时再清理。

---

## 风险指针核心设计思路

### 1. 全局风险指针数组与 RAII 槽位分配

我们维护一个固定大小的全局风险指针数组 `hazard_pointers[max_hazard_pointers]`。数组中的每个槽位（Slot）包含两个原子成员：
- `std::atomic<std::thread::id> id`：记录当前占用该槽位的线程 ID（若为空闲槽位，则为默认构造的空 `std::thread::id()`）。
- `std::atomic<void*> pointer`：记录该线程当前正在受保护访问的节点地址。

为了避免每次调用 `pop()` 都去遍历全局数组寻找空闲槽位，我们引入一个**RAII 管理者类 `hp_owner`**，并将其声明为**线程局部静态变量（`thread_local static`）**：
- **首次调用初始化**：每个线程第一次调用 `get_hazard_pointer_for_current_thread()` 时，构造属于本线程的 `hp_owner` 对象，通过 CAS 在全局数组 `hazard_pointers` 中抢占一个空闲槽位。
- **后续零开销复用**：该线程后续再次调用 `pop()` 时，直接复用已绑定的槽位，无需重新遍历查找。
- **线程退出自动归还**：当线程生命周期结束销毁时，局部静态对象 `hp_owner` 自动调用析构函数，将槽位的 `pointer` 置空并把 `id` 恢复为空值，完美归还槽位给未来的新线程。

---

### 2. `pop()` 中双重校验循环的并发奥秘

在 `pop()` 函数中，读取栈顶 `head` 并将其登记到风险指针 `hp` 的过程，必须使用一个内层 `do-while` 循环进行**双重读取校验**：

```cpp
std::atomic<void*>& hp = get_hazard_pointer_for_current_thread();
node* old_head = head.load();
do {
    node* temp;
    do {
        temp = old_head;
        hp.store(old_head);      // 步骤 A：将读取到的 old_head 登记为风险指针
        old_head = head.load();  // 步骤 B：重新读取最新的 head 进行二次确认
    } while (old_head != temp);  // 若两次读取不一致，说明在登记期间 head 已被其他线程修改！
} while (old_head && !head.compare_exchange_strong(old_head, old_head->next));
```

**为什么必须要有内层 `do-while` 循环？**
假设没有内层循环，线程 1 刚读取 `old_head = head.load()`（指向节点 A），**还没来得及执行 `hp.store(old_head)`** 时就被操作系统挂起：
1. 线程 2 此时恰好把节点 A 弹出，检查全局风险数组发现**根本没人登记节点 A**，于是线程 2 直接把节点 A `delete` 销毁了！
2. 线程 1 恢复运行，把已经变成野指针的 A 存入 `hp`，随后在 CAS 中解引用 `old_head->next` —— **直接引发段错误崩溃！**

**内层循环的作用**：先登记 `hp.store(old_head)`，再重新读取一次 `head.load()`。如果前后两次一致（`old_head == temp`），说明在“登记完成的瞬间”，节点 A 依然稳稳地挂在栈顶、绝对没有被其他线程弹出销毁！此时 `hp` 的保护正式生效，后续解引用 `old_head->next` 100% 安全。

> **⚠️ 勘误说明（对原博文解析的修正）：**
> 1. 原博文中提到“从全局**链表**中返回一个可用的节点”，此处属于笔误，代码中实际使用的是固定大小的**全局数组**（`hazard_pointer hazard_pointers[max_hazard_pointers]`）。
> 2. 原博文中在解释为什么要用 `compare_exchange_strong` 时写道“保证多线程情况下 `head` 的移动唯一”。更准确的底层原因是：在嵌套循环中，如果使用 `compare_exchange_weak` 发生**伪失败（Spurious Failure）**，会导致外层循环重新执行整个内层 `do-while` 循环（多做一次无意义的 `hp.store` 和 `head.load` 原子内存屏障开销），因此这里使用 `compare_exchange_strong` 避免伪失败引发额外开销。

---

## 代码实现

### 完整风险指针无锁栈实现（`hazard_pointer_stack.h`）

该实现源自《C++ 并发编程实战（第 2 版）》，包含全局风险指针数组管理、RAII 槽位生命周期绑定以及无饥饿节点的延迟回收链表。

```cpp
#pragma once
#include <atomic>
#include <memory>
#include <thread>
#include <stdexcept>
#include <functional>

// 最大支持并发访问无锁栈的线程数
unsigned const max_hazard_pointers = 100;

// 风险指针槽位结构体
struct hazard_pointer
{
    std::atomic<std::thread::id> id;
    std::atomic<void*> pointer;
};

// 全局风险指针数组（所有线程共享同一份全局注册表）
hazard_pointer hazard_pointers[max_hazard_pointers];

// RAII 风险指针槽位拥有者：负责在线程首次使用时申请槽位，线程退出时自动归还
class hp_owner
{
private:
    hazard_pointer* hp;

public:
    hp_owner(hp_owner const&) = delete;
    hp_owner& operator=(hp_owner const&) = delete;

    hp_owner() : hp(nullptr)
    {
        for (unsigned i = 0; i < max_hazard_pointers; ++i)
        {
            std::thread::id old_id; // 默认构造为空线程 ID
            // 通过 CAS 原子抢占空闲槽位
            if (hazard_pointers[i].id.compare_exchange_strong(old_id, std::this_thread::get_id()))
            {
                hp = &hazard_pointers[i];
                break;
            }
        }
        if (!hp)
        {
            throw std::runtime_error("No hazard pointers available");
        }
    }

    std::atomic<void*>& get_pointer()
    {
        return hp->pointer;
    }

    ~hp_owner()
    {
        // 必须先清空指针，再释放线程 ID 归还槽位
        hp->pointer.store(nullptr);
        hp->id.store(std::thread::id());
    }
};

// 获取当前线程专属的风险指针槽位引用
std::atomic<void*>& get_hazard_pointer_for_current_thread()
{
    // 每个线程拥有独立的线程局部静态实例，首次调用时初始化并绑定全局数组槽位
    thread_local static hp_owner hazard;
    return hazard.get_pointer();
}

// 查询全局风险指针数组中是否仍有线程正在指向目标节点 p
bool outstanding_hazard_pointers_for(void* p)
{
    for (unsigned i = 0; i < max_hazard_pointers; ++i)
    {
        if (hazard_pointers[i].pointer.load() == p)
        {
            return true;
        }
    }
    return false;
}

// 待回收节点封装结构体
template<typename T>
void do_delete(void* p)
{
    delete static_cast<T*>(p);
}

struct data_to_reclaim
{
    void* data;
    std::function<void(void*)> deleter;
    data_to_reclaim* next;

    template<typename T>
    data_to_reclaim(T* p) : data(p), deleter(&do_delete<T>), next(nullptr) {}

    ~data_to_reclaim()
    {
        deleter(data);
    }
};

// 全局待回收节点无锁链表头指针
std::atomic<data_to_reclaim*> nodes_to_reclaim;

// 将待回收包装节点通过 CAS 头插进全局待回收链表
void add_to_reclaim_list(data_to_reclaim* node)
{
    node->next = nodes_to_reclaim.load();
    while (!nodes_to_reclaim.compare_exchange_weak(node->next, node));
}

// 封装当前节点并放入延迟回收链表
template<typename T>
void reclaim_later(T* data)
{
    add_to_reclaim_list(new data_to_reclaim(data));
}

// 遍历待回收链表，清理所有已经不再受任何风险指针保护的节点
void delete_nodes_with_no_hazards()
{
    // 原子接管整条待回收链表
    data_to_reclaim* current = nodes_to_reclaim.exchange(nullptr);
    while (current)
    {
        data_to_reclaim* const next = current->next;
        if (!outstanding_hazard_pointers_for(current->data))
        {
            // 没有任何线程在使用该节点，安全销毁
            delete current;
        }
        else
        {
            // 仍有线程在读取该节点，重新挂回待回收链表等待下次清理
            add_to_reclaim_list(current);
        }
        current = next;
    }
}

// 基于风险指针的无锁并发栈
template<typename T>
class hazard_pointer_stack
{
private:
    struct node
    {
        std::shared_ptr<T> data;
        node* next;

        node(T const& data_) : data(std::make_shared<T>(data_)), next(nullptr) {}
    };

    std::atomic<node*> head;

public:
    hazard_pointer_stack() : head(nullptr) {}

    ~hazard_pointer_stack()
    {
        while (pop());
        delete_nodes_with_no_hazards();
    }

    hazard_pointer_stack(const hazard_pointer_stack&) = delete;
    hazard_pointer_stack& operator=(const hazard_pointer_stack&) = delete;

    void push(T const& value)
    {
        node* const new_node = new node(value);
        new_node->next = head.load();
        while (!head.compare_exchange_weak(new_node->next, new_node));
    }

    std::shared_ptr<T> pop()
    {
        // 1. 获取当前线程的风险指针引用
        std::atomic<void*>& hp = get_hazard_pointer_for_current_thread();
        node* old_head = head.load();

        do
        {
            node* temp;
            // 2. 双重读取校验循环：确保登记进 hp 的节点地址与当前实际栈顶严格一致
            do
            {
                temp = old_head;
                hp.store(old_head);
                old_head = head.load();
            } while (old_head != temp);
        }
        // 3. 尝试原子弹出栈顶节点
        while (old_head && !head.compare_exchange_strong(old_head, old_head->next));

        // 4. 已经成功弹出（或栈为空），本线程不再需要访问 old_head->next，立即清空风险指针
        hp.store(nullptr);

        std::shared_ptr<T> res;
        if (old_head)
        {
            res.swap(old_head->data);

            // 5. 检查是否有其他并发线程的风险指针正指向这个刚弹出的 old_head
            if (outstanding_hazard_pointers_for(old_head))
            {
                // 6. 有其他线程正在引用它，放入延迟回收链表
                reclaim_later(old_head);
            }
            else
            {
                // 7. 没有任何线程引用它，当场直接安全 delete！
                delete old_head;
            }

            // 8. 顺便扫描并清理历史待回收链表中已经解除风险的节点
            delete_nodes_with_no_hazards();
        }
        return res;
    }
};
```

---

## 测试用例

通过 1 个生产者线程与 2 个高频消费者线程进行高并发压测，验证风险指针保护下数据无丢失、无重复且无内存访问越界：

```cpp
#include <iostream>
#include <thread>
#include <set>
#include <mutex>
#include <cassert>
#include "hazard_pointer_stack.h"

void TestHazardPointer()
{
    hazard_pointer_stack<int> hazard_stack;
    std::set<int> rmx_set;
    std::mutex set_mtx;

    // 线程 1：连续压入 20000 个元素
    std::thread t1([&]() {
        for (int i = 0; i < 20000; i++) {
            hazard_stack.push(i);
            std::cout << "push data " << i << " success!" << std::endl;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
    });

    // 线程 2：并发弹出 10000 个元素
    std::thread t2([&]() {
        for (int i = 0; i < 10000; ) {
            auto head = hazard_stack.pop();
            if (!head) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            std::lock_guard<std::mutex> lock(set_mtx);
            rmx_set.insert(*head);
            std::cout << "pop data " << *head << " success!" << std::endl;
            i++;
        }
    });

    // 线程 3：并发弹出另外 10000 个元素
    std::thread t3([&]() {
        for (int i = 0; i < 10000; ) {
            auto head = hazard_stack.pop();
            if (!head) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            std::lock_guard<std::mutex> lock(set_mtx);
            rmx_set.insert(*head);
            std::cout << "pop data " << *head << " success!" << std::endl;
            i++;
        }
    });

    t1.join();
    t2.join();
    t3.join();

    assert(rmx_set.size() == 20000);
}
```

---

## 优劣分析

### 1. 优势
- **彻底解决内存回收饥饿**：即使在 100% 满载并发下，只要其他线程推进过当前节点并清空自己的风险指针，该节点就能在随后的 `pop()` 中立即被回收，绝不会像单纯的延迟删除链表那样发生内存无限堆积。
- **精细化内存保护**：只锁定真正正在被读取的单个节点地址，不影响其他无关联节点的及时释放。

### 2. 劣势与性能瓶颈
- **扫描开销较大（$O(N)$ 复杂度）**：每次尝试回收节点时，都需要调用 `outstanding_hazard_pointers_for` 遍历整个全局风险指针数组（例如遍历 100 个槽位）；若待回收链表中有 $M$ 个节点，每次扫描就是 $O(M \times N)$ 的原子读取操作，缓存行读取开销不小。
- **动态节点分配开销**：每次将节点放入待回收链表时，都需要额外 `new` 一个 `data_to_reclaim` 包装节点，增加了堆内存分配器压力。
- **工程优化方向**：
  - **批量延迟回收（Batching）**：不必每次 `pop` 都遍历清理，可以等待回收链表积累到 $2N$（$N$ 为最大线程数）个节点时再统一批量扫描一次，将均摊复杂度降至 $O(1)$。
  - **工业级替代方案**：目前高性能无锁库（如 Rust 的 Crossbeam、Linux 内核 RCU）更倾向于使用**基于纪元的内存回收（Epoch-Based Reclamation, EBR）**或**引用计数（如 C++20 `std::atomic<std::shared_ptr<T>>`）**，在读取路径上几乎零开销。

---

## 个人困惑

> 本节针对学习风险指针机制时涉及的 `thread_local` 生命周期与全局数组所有权绑定问题进行深度剖析。

### 1. `thread_local static hp_owner hazard;` 这里为什么要同时写成 `thread_local static`？

::: details 展开详细解答：存储期（Storage Duration）与链接属性、函数内局部变量的生命周期
**简答：**在函数内部声明变量时，`thread_local` 隐含了 `static` 的存储期语义，写 `thread_local static` 是为了**显式强调其“跨函数调用持久存活”的特性**。

#### 1. 如果不加 `thread_local`（普通局部变量）会怎样？
如果写成普通的 `hp_owner hazard;`：
- 每次调用 `pop()` 进入 `get_hazard_pointer_for_current_thread()` 时，都会在栈上重新构造一个 `hp_owner`，**遍历 100 次全局数组去抢槽位**；
- 函数一返回，`hazard` 立刻析构并归还槽位；
- 这会导致每次 `pop()` 都要做 $O(N)$ 的数组扫描和 CAS 抢占，性能大打折扣！

#### 2. 加上 `thread_local static` 后的三大核心效果：
1. **线程隔离（Thread-Local）**：每个线程都拥有自己独立的一份 `hazard` 实例，线程 1 和线程 2 各自拥有各自的 `hp_owner`，互不干扰、无需加锁。
2. **持久存活（Static Storage Duration in Thread）**：它的生命周期不再局限于 `get_hazard_pointer_for_current_thread()` 这一次函数调用，而是**从该线程第一次调用此函数开始，一直存活到该线程彻底退出销毁为止**！
3. **自动 RAII 回收**：当线程运行结束被系统销毁时，C++ 运行时会自动触发该线程所有 `thread_local` 对象的析构函数（`~hp_owner()`），自动把占用的槽位清空归还给全局数组，完美杜绝槽位泄漏。

*(注：在 C++11 及以后标准中，块作用域内的 `thread_local` 变量默认就具有线程静态存储期，写 `thread_local` 和 `thread_local static` 在语义上是完全等价的，加上 `static` 是一种增强代码可读性的习惯写法。)*
:::

### 2. 每个线程都会生成自己的 `hp_owner` 对象，会不会导致每个线程都在操作自己私有的 `hazard_pointers` 数组？

::: details 展开详细解答：“指向全局数组的指针” vs “数组本身”
**简答：**绝对不会！每个线程私有的是 **`hp_owner` 管理者（里面只存了一个指针）**，而它们指向的 **`hazard_pointers` 数组是全进程唯一共享的全局数组**。

#### 形象比喻：图书馆存包柜与钥匙牌
可以把这个设计想象成图书馆门口的一排公共存包柜：

```text
全局公共存包柜数组: hazard_pointers[100]（全进程只有这一份！）
┌─────────────────┬─────────────────┬─────────────────┬─────┐
│   槽位 [0]      │   槽位 [1]      │   槽位 [2]      │ ... │
│ id: 线程1       │ id: 线程2       │ id: 空闲        │     │
│ ptr: 0x7ff01    │ ptr: 0x7ff08    │ ptr: nullptr    │     │
└────────▲────────┴────────▲────────┴─────────────────┴─────┘
         │                 │
         │ (指针指向)       │ (指针指向)
┌────────┴────────┐ ┌──────┴──────────┐
│ 线程 1 私有对象  │ │ 线程 2 私有对象  │
│ hp_owner hazard │ │ hp_owner hazard │
│ (仅存指针 hp)    │ │ (仅存指针 hp)    │
└─────────────────┘ └─────────────────┘
```

1. **数组是全局唯一的**：`hazard_pointer hazard_pointers[max_hazard_pointers];` 定义在全局命名空间中，整个程序运行期间在全局数据区（BSS 段）**只有唯一的一份实例**。
2. **`hp_owner` 只是一把“钥匙”**：看看 `hp_owner` 类的成员变量，里面**并没有数组**，只有一个指针：
   ```cpp
   private:
       hazard_pointer* hp; // 仅仅是一个指向全局数组某个元素的指针！
   ```
3. **分工协作闭环**：
   - **线程 1** 的 `hp_owner` 抢占了全局数组的 `0` 号格子（`hp = &hazard_pointers[0]`），线程 1 以后每次 `pop` 都往 `0` 号格子里写自己正在读取的节点地址。
   - **线程 2** 的 `hp_owner` 抢占了全局数组的 `1` 号格子（`hp = &hazard_pointers[1]`），线程 2 以后每次 `pop` 都往 `1` 号格子里写自己正在读取的节点地址。
   - 当**线程 1** 准备 `delete old_head` 时，它调用 `outstanding_hazard_pointers_for(old_head)`，扫描的是**整排公共存包柜（0 ~ 99 号格子）**！因此线程 1 能够清晰地看到线程 2 放在 `1` 号格子里的地址，从而知道“线程 2 正在用这个节点，我不能删！”
:::

### 3. `hazard_pointer` 结构体的两个成员（`id` 和 `pointer`）为什么都是 `atomic` 修饰的？[cite: 15, 16]

::: details 展开详细解答：多线程并发读写竞争、数据竞争（Data Race）与 CPU 内存可见性
**简答：**因为 `hazard_pointers` 数组是**全进程多线程共享的**[cite: 16]，对 `id` 和 `pointer` 的读写几乎永远处于**“一写多读”或“多写竞争”**状态。在 C++ 内存模型中，只要多个线程同时访问同一内存地址且至少有一个是写操作，不加原子保护就会直接触发**未定义行为（Data Race）**。

#### 1. 为什么 `id` 必须是 `std::atomic<std::thread::id>`？[cite: 16]
- **写入端（多写竞争）**：当多个新线程同时首次调用 `pop()` 构造 `hp_owner` 时，它们会并发遍历全局数组，争抢同一个空闲槽位（`id == std::thread::id()`）[cite: 16]。这里必须依赖 `id.compare_exchange_strong(...)` 原子指令来保证“检查为空 + 写入自己线程 ID”不可分割，防止两个线程同时抢占同一个格子[cite: 16]。
- **释放端（跨线程并发读写）**：当某线程退出执行 `~hp_owner()` 归还槽位（`hp->id.store(std::thread::id())`）的同一瞬间，其他新线程可能正在遍历该槽位执行 `compare_exchange_strong`，非原子读写会导致读取到撕裂的线程 ID 状态[cite: 16]。

#### 2. 为什么 `pointer` 必须是 `std::atomic<void*>`？[cite: 16]
- **一写多读的跨线程可见性**：
  - **写操作**：线程 A 在自己的 `pop()` 循环里频繁修改自己槽位的地址（`hp.store(old_head)` 和 `hp.store(nullptr)`）[cite: 16]。
  - **读操作**：与此同时，线程 B、C、D 在销毁节点前，都在调用 `outstanding_hazard_pointers_for()` 遍历读取整个数组所有槽位的 `pointer.load()`[cite: 16]。
- **防止编译器重排与缓存不可见（最致命隐患）**：
  - 如果 `pointer` 只是普通裸指针 `void*`，编译器优化可能会把 `hp = old_head` 缓存在线程 A 的 CPU 寄存器里不写回内存，或者把 `hp = old_head` 重排到 `head.load()` 后面！
  - 使用 `std::atomic<void*>` 默认自带 `std::memory_order_seq_cst`（顺序一致性内存屏障），既保证了每次写入立刻对所有 CPU 核心可见，又严格锁死了指令重排，确保“先登记风险指针，再二次校验 `head`”的时序绝对成立[cite: 16]。
:::

### 4. `pop()` 中内层 `while` 循环与外层 `while` 循环各自的核心职责是什么？[cite: 15, 16]

::: details 展开详细解答：“安全登记保护窗口（内循环）” vs “原子弹出栈顶（外循环）”的职责边界
**简答：**你的理解非常精准！可以精炼概括为：**内层循环负责“在节点被删前给它套上保护罩（验证登记期间未被修改）”，外层循环负责“真正推进修改栈顶指针 `head`”[cite: 15, 16]。**

```cpp
std::atomic<void*>& hp = get_hazard_pointer_for_current_thread();
node* old_head = head.load();
do {
    node* temp;
    do {
        temp = old_head;
        hp.store(old_head);      // 1. 登记保护
        old_head = head.load();  // 2. 二次核对
    } while (old_head != temp);  // 【内层循环】：确保登记期间 head 没被别人改掉
} while (old_head && !head.compare_exchange_strong(old_head, old_head->next)); // 【外层循环】：CAS 真正弹出节点
```[cite: 16]

#### 双重循环的分工拆解
1. **内层 `do-while`（防野指针保护期）**：[cite: 16]
   - 在执行 `hp.store(old_head)` 之前，`old_head` 处于**完全裸奔**状态，随时可能被其他线程弹出并 `delete`[cite: 16]。
   - 内层循环的唯一使命，就是不断重试“登记 `hp` -> 重新读取 `head`”，直到前后两次读取结果一致（`old_head == temp`）[cite: 16]。一旦跳出内层循环，就意味着**在 `hp` 生效的瞬间，该节点依然稳稳挂在栈顶、绝对安全存活**，此时代码才敢安全地去解引用 `old_head->next`[cite: 16]。
2. **外层 `do-while`（并发状态推进期）**：[cite: 16]
   - 即使节点已经受 `hp` 保护（不会被 `delete`），多个线程依然可能同时拿到了同一个 `old_head`，并同时尝试执行 `head.compare_exchange_strong(old_head, old_head->next)` 去抢占弹出权[cite: 16]。
   - **只有一个线程能 CAS 成功**；其余失败的线程会由 `compare_exchange_strong` 自动把最新栈顶写入 `old_head`，然后**重新回到内层循环**，为新的 `old_head` 重新套上风险指针保护罩，再次尝试弹出[cite: 16]。
:::

### 5. 待删除节点 `nodes_to_reclaim` 可以放进类中吗？全局待删除链表与类内封装有什么区别？[cite: 15, 16]

::: details 展开详细解答：通用内存回收底座（类型擦除）vs 单容器私有化封装的工程权衡
**简答：**完全可以放进 `hazard_pointer_stack` 类中作为私有成员变量，且放进类里后连 `struct data_to_reclaim` 包装结构体都可以一并省掉，直接复用 `std::atomic<node*> nodes_to_reclaim` 即可[cite: 16]。

#### 全局定义 vs 类内封装核心对比

| 对比维度 | 全局定义（原书/博主写法） | 类内封装（`std::atomic<node*>` 成员） |
| :--- | :--- | :--- |
| **设计初衷** | 抽离出一个**全进程通用的无锁垃圾回收底座**，供不同类型（`stack<int>`、`stack<string>`）甚至不同容器（如无锁队列）共用[cite: 16]。 | **单容器专有化管理**，每个栈实例自己管理自己弹出的延迟回收节点。 |
| **类型擦除开销** | **有额外开销**：因为不知道具体容器的节点类型，必须用 `data_to_reclaim` 结构体封装 `void*` 和 `std::function<void(void*)>`，每次延迟回收都要额外 `new` 一个包装节点[cite: 16]。 | **零额外开销**：类本身是 `template<typename T>`，直接复用弹出节点自带的闲置 `node* next` 指针串联链表，无需 `new` 包装节点，也无需 `std::function`[cite: 16]。 |
| **多实例干扰** | **存在跨实例干扰**：`stackA` 积压的待删节点会拖慢 `stackB` 的 `pop()` 扫描速度，且所有容器在同一个全局链表头上做 CAS 竞争[cite: 16]。 | **彻底隔离**：不同栈实例的待删链表完全独立，互不影响缓存行与扫描耗时。 |
| **生命周期与析构** | 全局变量在 `main()` 结束后才销毁，若节点析构依赖其他全局资源，容易触发**全局析构顺序隐患**。 | **符合 RAII 闭环**：可在 `~hazard_pointer_stack()` 析构函数中直接遍历清理残留节点，生命周期清晰可控[cite: 16]。 |
:::

---

## 个人总结

::: details 点击展开个人总结：池化资源租借型 RAII 深度解析
- **核心认知跃迁**：[cite: 15, 16]
  之前接触的传统 RAII（如 `std::lock_guard`、`std::unique_ptr`），本质是**“独占创建并销毁底层物理资源”**（构造时加锁或 `new` 分配内存，析构时解锁或 `delete` 销毁资源）。
  而本例中 `hp_owner` 配合 `thread_local static` 展示了一种在并发与系统编程中极其经典的**“池化资源租借型 RAII（Scoped Lease / Resource Pool RAII）”**[cite: 15, 16]：

#### 这种 RAII 模式是如何运作的？
1. **底层资源全局预分配（不随 RAII 销毁）**：[cite: 16]
   全局数组 `hazard_pointers[100]` 就像一个固定容量的公共资源池（类似数据库连接池或图书馆存包柜），在程序启动时就已经分配好，整个进程生命周期内不会被销毁[cite: 16]。
2. **构造函数 = “搜索并租借绑定”（Acquire / Lease）**：[cite: 15, 16]
   当线程第一次调用 `get_hazard_pointer_for_current_thread()` 时，构造 `hp_owner` 对象[cite: 16]。构造函数遍历全局数组，通过 `compare_exchange_strong` 原子抢占第一个空闲槽位（将空 `id` 替换为当前线程 ID），并将该槽位的地址保存在私有指针 `hp` 中，完成**“线程 ↔ 公共槽位”的一对一绑定**[cite: 15, 16]。
3. **借助 `thread_local static` 实现“一次租借，全线程周期复用”**：[cite: 16]
   因为 `hazard` 被声明为线程局部静态变量，它的生命周期与当前线程严格绑定[cite: 16]。线程后续执行成千上万次 `pop()` 时，直接通过 `hazard.get_pointer()` 复用已租借到的槽位，完全省去了反复扫描和抢占数组的开销[cite: 16]。
4. **析构函数 = “清理状态并退租归还”（Release / Return）**：[cite: 15, 16]
   当线程运行结束被系统销毁时，C++ 运行时会自动触发该线程所有 `thread_local` 对象的析构函数 `~hp_owner()`[cite: 16]：
   ```cpp
   ~hp_owner() {
       hp->pointer.store(nullptr);       // 1. 先擦除残留节点地址（防止误判）
       hp->id.store(std::thread::id());  // 2. 再清空线程 ID（正式退租，恢复为空闲槽位）
   }
   ```[cite: 16]
   槽位物理内存本身没有被 `delete`，而是被**干净地归还回全局池**，供后续新创建的线程继续租借复用，彻底杜绝了动态创建/销毁线程场景下的槽位泄漏问题[cite: 16]。

- **常见工业级应用场景**：[cite: 15]
  这种“线程局部持有 + 构造时从全局池认领 + 线程退出时自动归还”的 RAII 范式，在高性能服务器开发中非常常见，例如：**线程局部内存池缓存（Thread-Local Arena/Cache，如 TCMalloc/Jemalloc）**、**无锁日志系统的线程局部 RingBuffer 槽位绑定**等。
:::
---

## 本例主线脉络

```text
                              线程调用 pop()
                                    │
                                    ▼
         [ 获取本线程专属风险指针槽位引用: hp = &hazard_pointers[i] ]
                                    │
                                    ▼
            ┌───► [ 1. 登记风险指针: hp.store(old_head) ]
            │                       │
            │                       ▼
            │     [ 2. 二次读取确认: old_head = head.load() ]
            │                       │
            └─── (若 old_head != temp，说明期间 head 变了，重试)
                                    │
                                    ▼
               [ 3. CAS 原子弹出栈顶: head -> old_head->next ]
                                    │
                                    ▼
                  [ 4. 清空风险指针: hp.store(nullptr) ]
                                    │
                                    ▼
         [ 5. 扫描全局 hazard_pointers 数组是否有人指向 old_head ]
                  ├── 有人指向 (有风险) ──► 放入 nodes_to_reclaim 延迟链表
                  └── 无人指向 (无风险) ──► 当场直接 delete old_head
                                    │
                                    ▼
           [ 6. 顺便扫描 nodes_to_reclaim，清理已解除风险的历史节点 ]
```

**一句话总结：风险指针通过“全局注册表数组 + 线程局部 RAII 槽位绑定 + 读取前双重校验”，让每个线程精准公开自己正在访问的节点地址，从而在完全无锁且无回收饥饿的前提下实现安全的并发内存释放。**

## 完整代码的位置
::: tip
/home/ycx/Code/thred_learning/19_LockFreeStack
:::