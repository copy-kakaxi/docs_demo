# 线程安全的链表（细粒度锁与手递手加锁实现）

## 简介
前文介绍了基于锁实现线程安全的栈、队列以及基于分桶锁实现的查找表。在之前的线程安全查找表中，每个桶内部使用了 `std::list`，每次增删改查仍需锁住整个桶内的链表，锁粒度依然有进一步精细化的空间。

如果想要进一步提高并发度，直接对链表本身进行细粒度并发控制，最直接的思路不是用一把大锁控制整条链表，而是**将互斥量分散到每个链表节点中**。本文将介绍如何通过节点级细粒度锁与**手递手加锁（Hand-over-hand Locking / 锁穿梭）**机制，实现一个高并发读写、天然规避死锁的单向链表，并深入探讨扩展“尾部插入”时所面临的并发陷阱。

---

## 细粒度锁链表原理

普通链表由一系列节点组成，每个节点包含数据域和指向下一个节点的指针。

如果仅使用单一互斥量控制整个链表，所有线程对链表的访问都会被强行串行化。为了分化互斥量的压力，我们让**每个节点自身维护一个互斥量 `std::mutex`**。

### 1. 虚节点（Dummy Head / 哨兵节点）
为了统一边界条件处理，链表头部引入一个不存储业务数据的**虚节点（head）**：
- 即使链表为空（没有数据节点），`head` 及其互斥量始终存在。
- 头插法、删除首个有效节点等操作，逻辑上都退化为对 `head` 及其后续节点的普通中间插入与删除，无需特殊处理空指针判断与指针引用的重定向。

```text
head（虚节点）
[ data: null | mtx | next ] ───► [ data: 12 | mtx | next ] ───► [ data: 13 | mtx | next ] ───► nullptr
```

### 2. 手递手加锁（Hand-over-hand Locking / 锁穿梭）
在链表遍历、查找或按条件删除时，必须保证指针安全性与操作原子性，但又不能锁住全表。核心操作逻辑如下：
1. 先锁住当前节点（例如 `current`，初始为 `head`）。
2. 在持有当前节点锁的前提下，获取并锁住下一个节点（`next`）。
3. 成功锁住下一个节点后，**立即释放当前节点的锁**。
4. 将当前节点后移，重复上述滑动窗口过程。

```text
步骤 1: 锁住 Node A
        [ Node A (Locked) ] ───► [ Node B (Unlocked) ] ───► [ Node C ]

步骤 2: 锁住 Node B（同时持有 A 和 B 的锁）
        [ Node A (Locked) ] ───► [ Node B (Locked) ]   ───► [ Node C ]

步骤 3: 释放 Node A，转移所有权
        [ Node A (Unlocked) ] ───► [ Node B (Locked) ] ───► [ Node C ]
```

**为什么这种方式天然防死锁？**
所有涉及链表遍历的线程，加锁顺序必须严格按照拓扑方向（`head -> next -> next`）单向推进。破坏了死锁四大必要条件中的“循环等待”，因此多个并发遍历的线程之间绝不会发生死锁。

---

## 代码实现

### 1. 标准细粒度锁单向链表（`threadsafelist.h`）

该实现源自《C++ 并发编程实战》经典设计，支持头插、安全遍历、条件查找与条件删除。

```cpp
#pragma once
#include <mutex>
#include <memory>

template<typename T>
class threadsafe_list
{
    struct node
    {
        std::mutex m;
        std::shared_ptr<T> data;
        std::unique_ptr<node> next;
        
        node() : next() {}
        node(T const& value) : data(std::make_shared<T>(value)) {}
    };

    node head; // 哨兵虚节点

public:
    threadsafe_list() {}

    ~threadsafe_list()
    {
        remove_if([](node const&) { return true; });
    }

    threadsafe_list(threadsafe_list const& other) = delete;
    threadsafe_list& operator=(threadsafe_list const& other) = delete;

    // 头部插入：仅需锁住 head 节点
    void push_front(T const& value)
    {
        std::unique_ptr<node> new_node(new node(value));
        std::lock_guard<std::mutex> lk(head.m);
        new_node->next = std::move(head.next);
        head.next = std::move(new_node);
    }

    // 遍历操作：手递手加锁
    template<typename Function>
    void for_each(Function f)
    {
        node* current = &head;
        std::unique_lock<std::mutex> lk(head.m);
        while (node* const next = current->next.get())
        {
            std::unique_lock<std::mutex> next_lk(next->m);
            lk.unlock(); // 移交锁：释放前驱，持有后继
            f(*next->data);
            current = next;
            lk = std::move(next_lk);
        }
    }

    // 查找操作：返回满足谓词的第一个元素智能指针
    template<typename Predicate>
    std::shared_ptr<T> find_first_if(Predicate p)
    {
        node* current = &head;
        std::unique_lock<std::mutex> lk(head.m);
        while (node* const next = current->next.get())
        {
            std::unique_lock<std::mutex> next_lk(next->m);
            lk.unlock();
            if (p(*next->data))
            {
                return next->data;
            }
            current = next;
            lk = std::move(next_lk);
        }
        return std::shared_ptr<T>();
    }

    // 条件删除：同时持有前驱和当前节点锁进行指针解绑
    template<typename Predicate>
    void remove_if(Predicate p)
    {
        node* current = &head;
        std::unique_lock<std::mutex> lk(head.m);
        while (node* const next = current->next.get())
        {
            std::unique_lock<std::mutex> next_lk(next->m);
            if (p(*next->data))
            {
                // 命中删除条件：断开 next 节点连接
                std::unique_ptr<node> old_next = std::move(current->next);
                current->next = std::move(next->next);
                next_lk.unlock(); // 提前释放被删节点的锁，old_next 离开作用域自动 delete 销毁
            }
            else
            {
                lk.unlock();
                current = next;
                lk = std::move(next_lk);
            }
        }
    }
};
```

---

### 2. 尾插法扩展尝试（`tailpushlist.h` 剖析）

为了实现 $O(1)$ 复杂度的尾部插入，博主（恋恋风辰）尝试引入了尾指针 `last_node_ptr` 和一把专属保护锁 `last_ptr_mtx`：

```cpp
template<typename T>
class double_push_list
{
    struct node_d
    {
        std::mutex m;
        std::shared_ptr<T> data;
        std::unique_ptr<node_d> next;
        node_d() : next() {}
        node_d(T const& value) : data(std::make_shared<T>(value)) {}
    };

    node_d head;
    node_d* last_node_ptr;       // 尾指针
    std::mutex last_ptr_mtx;     // 保护尾指针读写的互斥量

public:
    double_push_list() {
        last_node_ptr = &head;
    }

    // 尝试支持尾部插入
    void push_back(T const& value) {
        std::unique_ptr<node_d> new_node(new node_d(value));
        // 试图通过 std::lock 同时锁定尾节点锁与指针锁
        std::lock(last_node_ptr->m, last_ptr_mtx);
        std::unique_lock<std::mutex> lk(last_node_ptr->m, std::adopt_lock);
        std::unique_lock<std::mutex> last_lk(last_ptr_mtx, std::adopt_lock);

        last_node_ptr->next = std::move(new_node);
        last_node_ptr = last_node_ptr->next.get();
    }

    // 头部插入时需判断是否影响尾指针
    void push_front(T const& value)
    {
        std::unique_ptr<node_d> new_node(new node_d(value));
        std::lock_guard<std::mutex> lk(head.m);
        new_node->next = std::move(head.next);
        head.next = std::move(new_node);

        // 如果是插入的第一个有效节点，更新尾指针
        if (head.next->next == nullptr) {
            std::lock_guard<std::mutex> last_lk(last_ptr_mtx);
            last_node_ptr = head.next.get();
        }
    }

    // 删除时判断是否删除了尾部节点
    template<typename Predicate>
    bool remove_first(Predicate p)
    {
        node_d* current = &head;
        std::unique_lock<std::mutex> lk(head.m);
        while (node_d* const next = current->next.get())
        {
            std::unique_lock<std::mutex> next_lk(next->m);
            if (p(*next->data))
            {
                std::unique_ptr<node_d> old_next = std::move(current->next);
                current->next = std::move(next->next);

                // 判断删除的是否为最后一个节点
                if (current->next == nullptr) {
                    std::lock_guard<std::mutex> last_lk(last_ptr_mtx);
                    last_node_ptr = current;
                }
                next_lk.unlock();
                return true;
            }

            lk.unlock();
            current = next;
            lk = std::move(next_lk);
        }
        return false;
    }
};
```

---

## 测试用例

```cpp
#include <iostream>
#include <thread>
#include <set>
#include "MyClass.h"
#include "tailpushlist.h"

void MultiThreadPush()
{
    double_push_list<MyClass> thread_safe_list;

    // 线程 1：高频头插 0 ~ 19999
    std::thread t1([&]() {
        for (int i = 0; i < 20000; i++) {
            MyClass mc(i);
            thread_safe_list.push_front(mc);
        }
    });

    // 线程 2：高频尾插 20000 ~ 39999
    std::thread t2([&]() {
        for (int i = 20000; i < 40000; i++) {
            MyClass mc(i);
            thread_safe_list.push_back(mc);
        }
    });

    // 线程 3：并发检索并删除 0 ~ 39999
    std::thread t3([&]() {
        for (int i = 0; i < 40000; ) {
            bool rmv_res = thread_safe_list.remove_first([&](const MyClass& mc) {
                return mc.GetData() == i;
            });

            if (!rmv_res) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            i++;
        }
    });

    t1.join();
    t2.join();
    t3.join();

    std::cout << "begin for each print...." << std::endl;
    thread_safe_list.for_each([](const MyClass& mc) {
        std::cout << "for each print " << mc << std::endl;
    });
    std::cout << "end for each print...." << std::endl;
}
```

---

## 优劣分析

### 1. 优势
- **锁粒度极细**：互斥量分散到每个节点内部，多个线程可以同时并发访问链表的不同节点区间，并发吞吐量远高于整表大锁。
- **手递手滑动**：查找、遍历和删除沿着单一拓扑方向流动，无需全局冻结链表即可安全推进。
- **哨兵虚节点简化并发分支**：始终由空头节点作为锁锚点，规避了链表由空变非空时的竞争条件。

### 2. 劣势与瓶颈
- **内存与系统调用开销大**：每个节点都包含一个 `std::mutex`（Linux 下通常占 40 字节），空间开销巨大；节点每次移动均伴随一次锁获取与释放，Cache 局部性极差。
- **析构递归风险**：单向 `std::unique_ptr` 级联析构在链表非常长时容易引起函数调用栈溢出（Stack Overflow）。
- **尾插法引入严重架构隐患**：引入 `last_node_ptr` 打破了单向加锁拓扑序，带来了竞态条件与野指针风险。

---

## 个人困惑

> 本节的核心不仅是掌握手递手锁（Lock Coupling）的滑动语法，更要从**房间开门、钥匙移交、内存所有权以及指令求值时序**等底层细节，透彻理解每一行代码的并发深意。
>
> 以下整理了对该实现最关键的 9 个并发困惑与深度解答。

### 1. 为什么博主代码中的 `push_back` 存在致命的野指针崩溃隐患？

::: details 展开详细解答：参数求值顺序、生命周期失效与 Use-After-Free
**简答：**在调用 `std::lock(last_node_ptr->m, last_ptr_mtx)` 这一瞬间，**保护 `last_node_ptr` 的锁尚未被持有**。程序必须先解引用裸指针去计算 `last_node_ptr->m` 的地址作为函数实参，此时若尾节点恰好被删除线程释放，将直接触发 **Use-After-Free (UAF) 或段错误（SIGSEGV）**。

#### 竞态时序还原
假设链表中只有一个有效节点 `A`，初始状态下 `last_node_ptr` 指向 `A`：

```text
时刻 t1: 线程 1 准备 push_back，执行到参数求值：
         先读取 last_node_ptr 的值（指向节点 A 的内存地址）。
时刻 t2: 线程 2（执行 remove_first）通过手递手锁抓到了 head 和节点 A。
         判断节点 A 满足删除条件，执行：
         current->next = std::move(next->next); // A 被移出链表
         old_next 析构，节点 A 的内存被释放（delete）！
时刻 t3: 线程 1 继续执行参数求值，试图访问 last_node_ptr->m。
         此时 A 已经被销毁，访问野指针内存，系统立即崩溃或行为未定义！
```

#### 为什么博主明知有锁顺序问题，却依然写成了 `std::lock`？
博主在博客中解释道：
- 如果先锁 `last_ptr_mtx` 再锁 `last_node_ptr->m`；
- 而删除操作（`remove_first`）是顺着链表从前往后加锁，它是“先锁节点 `next->m`，再在删除尾部时去锁 `last_ptr_mtx`”；
- 此时两者的**加锁顺序正好相反**，必然引发死锁！

博主为了防止死锁，改用 `std::lock` 试图同时加锁。但他忽略了 **C++ 语言的求值规则**：互斥量作为实参传递给 `std::lock` 之前，其引用的对象必须合法。裸指针的生命周期在加锁前根本得不到保障。
:::

### 2. 为什么工业级链表很少给每个节点分配一把 `mutex`？

::: details 展开详细解答：内存膨胀、Cache 局部性与上下文切换
**简答：**在工程实践中，节点级互斥锁属于典型的**“反模式”**。

1. **惊人的内存放大**：
   在 64 位 Linux 操作系统下，`std::mutex`（底层为 `pthread_mutex_t`）大小为 40 字节。如果链表存储的是一个 `int`（4 字节），加上指针与对齐，节点开销从原本的 16 字节暴增至 64~80 字节，内存有效载荷极低。
2. **高速缓存命中率崩溃（Cache Thrashing）**：
   频繁获取/释放每个节点的互斥锁，会导致 CPU 核心之间对锁状态对应的缓存行（Cacheline）展开疯狂的无效化通信（MESI 协议缓存一致性风暴），极度损伤吞吐量。
3. **真实替代解法**：
   - **分段锁/跳表（SkipList）**：如 LevelDB 的 MemTable，使用并发跳表替代链表。
   - **RCU（Read-Copy-Update）**：在 Linux 内核中广泛使用，读取操作完全零开销无需任何锁，写入操作通过宽限期（Grace Period）延迟回收节点，彻底解决遍历期间的 UAF 问题。
:::

### 3. `remove_if` 的 `else` 分支中，`lk.unlock();` 与 `current = next;` 的顺序写反了吗？

::: details 展开详细解答：房间比喻、最小化临界区与移动赋值
**简答：**没有写反，顺序非常正确且符合规范。

```cpp
else {
    lk.unlock();             // 1. 离开旧房间，开门放行
    current = next;          // 2. 指针后移进新房间
    lk = std::move(next_lk); // 3. 把新房间钥匙接管过来
}
```

1. **最小化临界区**：当前节点既然已经判定不满足条件，说明本次循环已经彻底完成了对当前节点的操作。尽早释放不再需要的旧锁，能够立刻让后续等待该节点的其他并发线程继续推进。
2. **形象的比喻（开门进房间）**：
   - `node* current = &head;` 表示在进入一个房间工作前先知道这个房间的门牌号；
   - `lk(head.m);` 表示锁上当前房间门，防止操作期间其他人闯入；
   - 在 `while` 内部，通过 `next_lk(next->m)` 把下一个房间门也锁住（手上同时握有两把钥匙）；
   - 在 `else` 中表明当前房间的事情干完了，赶紧把身后的门解锁（`lk.unlock()`）；
   - 人正式跨进新房间（`current = next`），再把临时钥匙交接给随身钥匙管家（`lk = std::move(next_lk)`）。
3. **保证安全的前提**：`next` 局部指针已经在获取 `next_lk` 保护下被稳妥读出，且 `next` 节点此时处于锁定保护中，因此先放开身后的 `current` 不会对栈上的 `next` 地址有效性产生任何威胁。
:::

### 4. `if` 分支中的 `next_lk.unlock();` 有必要写吗？它自己不会析构解锁吗？

::: details 展开详细解答：析构时序冲突与销毁“加锁中互斥量”的未定义行为
**简答：**非常必要，绝对不能省略！这里的核心矛盾在于：**节点的内存销毁与互斥锁的释放，哪个先发生？**

局部变量的析构顺序是**与声明顺序严格相反**（后定义的先析构）：
- `old_next` 在 `if` 块内部最晚声明，因此在离开作用域时**最先析构**；
- `next_lk` 是在 `while` 循环体顶部声明的（早于 `old_next`），它必须等 `if` 块内的局部变量都析构完毕后才轮到它析构。

#### 灾难时序还原（若不手动 unlock）：
1. `old_next` 析构，执行 `delete next`，调用节点的析构函数；
2. 节点的析构函数紧接着销毁其内部的成员变量 `node::m`（即 `std::mutex`）；
3. **此时致命崩溃爆发**：`next->m` 在被 `delete` 销毁的瞬间，依然处于被 `next_lk` **锁定的状态（locked）**！
4. **POSIX 与 C++ 标准明确规定**：销毁一个当前处于锁定状态的互斥锁是**未定义行为（UB）**，在 Linux 下会抛出段错误或触发 `pthread_mutex_destroy failed (EBUSY)`。

显式写出 `next_lk.unlock();` 确保了“**先让锁恢复为未加锁状态，随后再由 `old_next` 安全析构节点内存**”。
:::

### 5. `find_first_if` 和 `for_each` 中，为什么一拿到 `next_lk` 就马上把 `lk` 解开？

::: details 展开详细解答：读操作与写操作对手递手加锁要求的本质差异
**简答：**因为 `find_first_if` 和 `for_each` **只读不删**。

- 在 `remove_if` 中，删除节点需要修改前驱节点（`current`）的 `next` 指针，因此在修改指针期间，必须**同时持有 `current` 和 `next` 两把锁**。
- 而在 `find_first_if` 与 `for_each` 中，`current` 节点的作用仅仅是为了拿到下一个节点的地址。一旦成功锁定了 `next` 节点，当前线程只需专注于检查或遍历 `next` 内部的数据，`current` 节点的所有使命已经终结。立刻解开 `lk` 可以最大限度释放前驱节点，让紧随其后的其他并发读写线程通行。
:::

### 6. `remove_if` 中的 `current->next = std::move(next->next);` 能否写成 `old_next->next`？

::: details 展开详细解答：所有权转移视角的代码自洽性
**简答：**完全可以，而且语义上甚至更加直观、贴合现代 C++ 的所有权转移逻辑。

```cpp
std::unique_ptr<node> old_next = std::move(current->next);
current->next = std::move(old_next->next); // 完全合法且优雅！
```

1. **指向完全一致**：`next` 是从原 `current->next` 读取的裸指针，而 `old_next` 是独占管理该内存的智能指针，`old_next.get() == next`，因此两者访问的成员完全是同一个。
2. **所有权更清晰**：执行第一行后，`current->next` 已经置空，原节点唯一合法的宿主就是 `old_next`。从 `old_next` 中抽取出它的下游节点重新接回主干，生命周期链路非常明确，降低了阅读代码时对裸指针 `next` 的心智负担。
:::

### 7. `push_front` 中 `head.next = std::move(new_node);` 会导致 `new_node` 地址出问题吗？

::: details 展开详细解答：移动语义的本质与智能指针生命周期
**简答：**绝对不会。这混淆了“栈上智能指针对象自身地址”与“其管理的堆内存地址”。

- `new_node` 只是栈上的一个小对象（内含一个指向堆内存的裸指针）。
- `head.next = std::move(new_node);` 执行的是**所有权交接**：将堆对象的地址拷贝给 `head.next`，并将 `new_node` 内部的指针置为 `nullptr`。
- 堆上实际创建的 `node` 对象在内存物理地址上**根本没有动过**。
- 当 `push_front` 结束、栈上的 `new_node` 析构时，它检测到内部已经是 `nullptr`，因此什么都不做安全退场。堆对象已经被长久存活的 `head.next` 稳妥托管。
:::

### 8. `find_first_if` 推进时，能否写成 `current = current->next.get()`？

::: details 展开详细解答：失锁状态下的二次解引用与数据竞争
**简答：**编译能过，但**在并发场景下是致命的逻辑错误，绝不能这么写！**

回顾执行顺序：
```cpp
while (node* const next = current->next.get()) {
    std::unique_lock<std::mutex> next_lk(next->m);
    lk.unlock(); // <--- 关键点：current 此时已经被解锁！
    if (p(*next->data)) return next->data;
    
    current = next; // 为什么不能是 current = current->next.get()?
    lk = std::move(next_lk);
}
```

- 在进入 `if` 前，`lk.unlock()` 已经将 `current` 节点的锁彻底释放！
- 此时，当前线程对于 `current` 已经**没有任何互斥保护**。若有其他并发线程在此时执行 `remove_if`，完全可以修改甚至直接释放 `current->next`。
- 在无锁状态下去二次解引用 `current->next.get()`，会引发严重的**数据竞争（Data Race）**，可能读出悬垂指针导致 Crash。
- 必须使用 `current = next;`：因为栈变量 `next` 所指向的节点，此时正被当前线程的 `next_lk` **牢牢锁住**，内存绝对安全稳定。
:::

### 9. 测试函数 `t2` 中，若把 `i++` 写进 `for( ; ; i++)` 头部，`continue` 会导致递增吗？

::: details 展开详细解答：C++ 语法规范与自旋重试的逻辑正确性
**简答：**会导致 `i++` 被强制执行，从而引发严重的数据遗漏 Bug！

 C++: 规范
根据 C++ 标准，`for(init; condition; iteration_expression)` 中，遇到循环体内的 `continue;` 时，程序会**跳转到当前迭代末尾，强制执行 `iteration_expression`（即括号里的 `i++`）**，然后再进行条件判断。

 产生严重逻辑漏洞：
测试代码中 `t1` 插入与 `t2` 查找是并发跑的。当 `t2` 检索 `i = 5` 时，如果 `t1` 还没来得及插入，`find_res == nullptr` 成立，执行 `sleep_for` 并 `continue`：
- 若写在括号内：`continue` 会强行让 `i` 递增到 6！导致检索线程直接跳过了对 5 的等待，数字 5 永远不会被记录，最终测试集合出现数据缺失。
- 括号留空：`continue` 跳过后 `i` 保持原值，实现了精准的**自旋重试（Spin-Retry）**，直到找到节点才递增步进。
:::

---


---

## 本例主线脉络

```text
                           head（哨兵节点）
                                  │
                                  ▼
                         [ Lock(head.m) ]
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
            【push_front】                   【for_each / remove】
          直接在 head 后插入                 持有当前节点锁，获取下一节点锁
          释放 head.m，完成                  释放前驱锁，完成手递手穿梭
                                                  │
                                                  ▼
                                      【尾插扩展的并发断层】
                         尾指针 last_node_ptr 脱离了单向穿梭序列
                      导致在未锁 last_ptr_mtx 时访问 last_node_ptr 产生 UAF
```

**一句话总结：手递手加锁以单向拓扑序实现高并发无死锁遍历；但强行在单向细粒度锁链表上挂载裸尾指针，会打破加锁闭环，引入致命的生命周期竞态。**