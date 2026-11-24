# 使用延迟删除链表实现无锁并发栈

## 简介
前文我们通过独立的互斥机制（如细粒度锁、分桶锁）实现了并发安全的栈、队列以及查找表等数据结构。接下来，我们将进入无锁编程（Lock-Free Programming）领域，通过原子变量与比较交换（CAS）操作实现无锁并发容器。本文将首先从最基础的无锁数据结构——**无锁并发栈（Lock-Free Stack）**入手，并深入探讨其核心痛点：**无锁环境下的节点内存安全回收（延迟删除链表机制）**。

---

## 无锁栈的设计思路

栈容器是一种后进先出（LIFO）的线性结构。简单来讲，若依次将元素 `1, 2, 3, 4` 入栈，则出栈的顺序应为 `4, 3, 2, 1`。

### 1. 入栈（Push）的并发演化

**单线程下的入栈操作步骤：**
1. 创建新节点 `new_node`。
2. 将新节点的 `next` 指针指向当前的栈顶 `head` 节点。
3. 将 `head` 指针更新为新节点 `new_node`。

**多线程并发下的竞态隐患：**
假设线程 1 执行到第 2 步，刚刚将 `new_node->next` 指向当前的 `head` 节点；此时操作系统发生调度，线程 2 抢先执行完了第 2 步和第 3 步，将 `head` 更新为线程 2 插入的新节点。随后线程 1 恢复执行第 3 步，直接把 `head` 覆盖为线程 1 的节点——这会导致线程 2 插入的节点从链表中断开并永久丢失！

```text
初始状态:
head ──► [ node ] ──► [ node ] ──► nullptr

线程1准备插入 node1 (执行完第2步，尚未更新 head):
[ node1 ] ──► [ node ] ──► [ node ] ──► nullptr
                 ▲
                head

线程2抢先完成插入 node2 (更新了 head):
[ node2 ] ──► [ node ] ──► [ node ] ──► nullptr
   ▲
  head (同时 node1->next 仍指向旧的 node)

线程1继续执行第3步 (直接覆盖 head，导致 node2 丢失!):
[ node1 ] ──► [ node ] ──► [ node ] ──► nullptr
   ▲
  head
```

**无锁解决方案：**
我们可以通过原子变量的 `compare_exchange_weak`（比较并交换，CAS）操作来控制更新 `head` 节点。只有当 `head` 的当前值与 `new_node->next` 一致（即期间没有其他线程修改过栈顶）时，才将其原子更新为 `new_node`；若失败，`compare_exchange_weak` 会自动将 `new_node->next` 更新为最新的 `head` 值，循环重试即可。

---

### 2. 出栈（Pop）的三大核心痛点

单线程下出栈只需三步：① 取出头节点；② 更新 `head` 为 `head->next`；③ 返回头节点数据并释放内存。

但在多线程环境下，如果我们简单地套用 CAS 写出如下初版代码：
```cpp
template<typename T>
void pop(T& value) {
    node* old_head = head.load();
    while (!head.compare_exchange_weak(old_head, old_head->next));
    value = old_head->data; // 存在严重隐患！
}
```
上述代码存在三个致命问题：
1. **未判断<mark>空栈</mark>的情况**：当栈为空时，`old_head` 为 `nullptr`，此时解引用 `old_head->next` 会直接引发空指针崩溃。如果为空栈，我们可以令 `pop` 返回 `false` 或空智能指针（返回异常并不优雅且不利于无锁接口设计）。
2. **数据返回时的<mark>拷贝赋值</mark>异常安全问题**：将数据域赋值给引用类型的 `value` 时存在**拷贝赋值**操作。如果类型 `T` 的拷贝构造函数在执行时抛出异常，此时 `head` 已经被 CAS 弹出更新，元素已经从栈顶移除，数据将永久丢失（破坏了异常安全）。
   - **解决方式**：数据域不再直接存储 `T` 类型对象，而是存储 `std::shared_ptr<T>` 类型的智能指针。在节点构造时就于堆上分配好内存，出栈时直接通过指针转移所有权，智能指针在赋值/交换时绝不会抛出异常。
3. **未<mark>释放</mark>弹出节点的<mark>内存</mark>**：每次 `pop` 都会遗留一个废弃的 `node` 节点，长期运行必然引发严重的内存泄漏。

---

### 3. 为什么不能在 `pop` 中直接 `delete old_head`？

假如我们在 CAS 弹出节点并取出数据后，直接调用 `delete old_head`：
```text
时刻 t1: 线程 1 和线程 2 同时调用 pop()，都读取到同一个 old_head（节点 A）。
时刻 t2: 线程 1 的 CAS 成功，将 head 更新为 A->next，随后执行 delete old_head，节点 A 的内存被销毁！
时刻 t3: 线程 2 此时才执行到 while(!head.compare_exchange_weak(old_head, old_head->next))，
         在计算参数 old_head->next 时解引用已被释放的节点 A —— 触发 Use-After-Free 崩溃！
```

### 4. 核心破局思路：延迟删除链表（Pending Delete List）

为了解决悬垂指针问题，我们必须引入**延迟回收机制**：若当前有其他线程正在执行 `pop`，不能立即 `delete` 节点，而是将其挂载到一个专门的**待删除链表（`to_be_deleted`）**中，等到安全时机再统一清理。

**判断“安全回收时机”的三条黄金法则：**
1. **只有一个线程在 `pop` 时绝对安全**：如果在某一时刻，全进程**有且仅有当前 1 个线程**正在执行 `pop` 函数（不存在任何其他并发 `pop` 线程），那么当前线程弹出的 `old_head` 绝不可能被其他线程持有。此时不仅可以直接 `delete old_head`，还可以顺便把待删除链表 `to_be_deleted` 中的所有历史节点一并清空！
2. **多线程并发 `pop` 时不可删除列表**：如果检测到有多个线程同时处于 `pop` 流程中，任何线程都**不能**清空 `to_be_deleted` 链表（因为其他线程可能正读取着待删链表中某个节点的 `next` 指针）。此时只能将自己弹出的 `old_head` 头插进 `to_be_deleted` 链表中暂存。
3. **精细化并发计数（`threads_in_pop`）**：我们引入一个原子计数器 `std::atomic<unsigned> threads_in_pop`，在进入 `pop()` 时原子加 1，退出 `pop()` 时原子减 1，以此精准感知当前活跃的 `pop` 线程数量。

> **⚠️ 勘误说明（对原博文注释的修正）：**
> 原博文中在分析 `try_reclaim` 内部再次判断 `if (--threads_in_pop == 0)` 时曾解释为“因为前面没有用 `load()` 而是直接读取 `threads_in_pop == 1`”。实际上，`if (threads_in_pop == 1)` 本质上就是一次隐式的原子 `load()`！之所以需要再次判断 `--threads_in_pop`，是因为 `threads_in_pop == 1` 判断通过后、但在执行完 `exchange(nullptr)` 之前的极短时间窗口内，**完全可能有新的线程 B 闯入 `pop()` 并执行了 `++threads_in_pop`**。因此，在接管待删除链表后，必须通过原子减一 `--threads_in_pop` 的返回值来最终确认“在接管期间是否真的没有新线程闯入”。

---

## 代码实现

### 完整无锁并发栈实现（`lock_free_stack.h`）

该实现源自《C++ 并发编程实战（第 2 版）》经典设计，包含完整的原子入栈、无锁出栈以及基于原子计数器的延迟删除链表回收机制。

```cpp
#pragma once
#include <atomic>
#include <memory>

template<typename T>
class lock_free_stack
{
private:
    struct node
    {
        std::shared_ptr<T> data;
        node* next;

        node(T const& data_) : data(std::make_shared<T>(data_)), next(nullptr) {}
    };

    std::atomic<node*> head;                 // 原子栈顶指针
    std::atomic<unsigned> threads_in_pop;    // 记录当前正在执行 pop 的活跃线程数
    std::atomic<node*> to_be_deleted;        // 待删除节点链表的头指针

    // 辅助函数：遍历并彻底释放单向链表中的所有节点
    static void delete_nodes(node* nodes)
    {
        while (nodes)
        {
            node* next = nodes->next;
            delete nodes;
            nodes = next;
        }
    }

    // 尝试安全回收节点内存
    void try_reclaim(node* old_head)
    {
        // 1. 初步判断：当前是否仅有本线程在执行 pop
        if (threads_in_pop == 1)
        {
            // 原子地将整个待删除链表的所有权转移到当前线程的局部变量中，并将全局链表置空
            node* nodes_to_delete = to_be_deleted.exchange(nullptr);

            // 2. 再次确认：将活跃线程数减 1，检查在刚刚接管链表的瞬间是否有其他线程闯入 pop
            if (!--threads_in_pop)
            {
                // 确认无其他线程干扰，安全释放接管过来的整个待删除链表
                delete_nodes(nodes_to_delete);
            }
            else if (nodes_to_delete)
            {
                // 发现有新线程在刚刚的窗口期闯入了 pop！
                // 为了防止新线程正引用着链表中的节点，必须将接管过来的链表重新挂回 to_be_deleted
                chain_pending_nodes(nodes_to_delete);
            }

            // 无论是否有新线程闯入，old_head 都是本线程独占弹出的，且在接管前已被移出栈顶
            // 新闯入的线程绝不可能看到 old_head，因此 old_head 总是可以安全删除
            delete old_head;
        }
        else
        {
            // 当前有多个线程正在并发执行 pop，不能释放内存，将 old_head 挂入待删除链表
            chain_pending_node(old_head);
            --threads_in_pop;
        }
    }

    // 将整条待删除链表头插回全局 to_be_deleted
    void chain_pending_nodes(node* nodes)
    {
        node* last = nodes;
        // 遍历找到该局部链表的最后一个节点
        while (node* const next = last->next)
        {
            last = next;
        }
        chain_pending_nodes(nodes, last);
    }

    // 通过 CAS 原子地将 [first, last] 区间链表头插到 to_be_deleted 头部
    void chain_pending_nodes(node* first, node* last)
    {
        last->next = to_be_deleted;
        while (!to_be_deleted.compare_exchange_weak(last->next, first));
    }

    // 将单个节点加入待删除链表
    void chain_pending_node(node* n)
    {
        chain_pending_nodes(n, n);
    }

public:
    lock_free_stack() : head(nullptr), threads_in_pop(0), to_be_deleted(nullptr) {}

    ~lock_free_stack()
    {
        // 析构时清空栈中剩余节点以及待删除链表中的残留节点
        while (pop());
        delete_nodes(to_be_deleted.load());
    }

    lock_free_stack(const lock_free_stack&) = delete;
    lock_free_stack& operator=(const lock_free_stack&) = delete;

    // 无锁入栈操作
    void push(T const& value)
    {
        node* const new_node = new node(value);
        new_node->next = head.load();
        // 若 head 未被其他线程修改，则更新 head 为 new_node；否则自动更新 new_node->next 并重试
        while (!head.compare_exchange_weak(new_node->next, new_node));
    }

    // 无锁出栈操作
    std::shared_ptr<T> pop()
    {
        // 1. 入口处原子递增活跃线程计数，声明“本线程开始读取栈顶指针”
        ++threads_in_pop;

        node* old_head = head.load();
        // 2. CAS 循环弹出栈顶节点
        while (old_head && !head.compare_exchange_weak(old_head, old_head->next));

        std::shared_ptr<T> res;
        if (old_head)
        {
            // 3. 仅交换智能指针所有权，零拷贝且绝对不抛异常
            res.swap(old_head->data);
        }

        // 4. 尝试回收 old_head 或将其挂入延迟删除链表，并在内部递减 threads_in_pop
        try_reclaim(old_head);
        return res;
    }
};
```

---

## 测试用例

通过 1 个高频写入线程与 2 个高频并发弹出线程，验证多线程激烈竞争下无锁栈的数据完整性与内存安全性：

```cpp
#include <iostream>
#include <thread>
#include <set>
#include <mutex>
#include <cassert>
#include "lock_free_stack.h"

void TestLockFreeStack()
{
    lock_free_stack<int> lk_free_stack;
    std::set<int> rmx_set;
    std::mutex set_mtx;

    // 线程 1：连续压入 20000 个元素
    std::thread t1([&]() {
        for (int i = 0; i < 20000; i++) {
            lk_free_stack.push(i);
            std::cout << "push data " << i << " success!" << std::endl;
        }
    });

    // 线程 2：并发弹出 10000 个元素
    std::thread t2([&]() {
        for (int i = 0; i < 10000; ) {
            auto head = lk_free_stack.pop();
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
            auto head = lk_free_stack.pop();
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

    // 验证弹出的所有元素无丢失、无重复，总数严格等于 20000
    assert(rmx_set.size() == 20000);
}
```

---

## 优劣分析

### 1. 优势
- **真正的无锁推进（Lock-Free Progress）**：无论是 `push` 还是 `pop`，内部均不含任何互斥锁，不会因为某个线程被操作系统挂起（如时间片耗尽、缺页中断）而阻塞其他线程的进度。
- **彻底解决 ABA 导致的野指针崩溃**：在有线程正在读取 `old_head->next` 期间，节点绝不会被物理释放，从根本上杜绝了 Use-After-Free 问题。
- **强异常安全保证**：借助 `std::shared_ptr<T>` 提前在入栈时分配数据内存，出栈时仅做原子指针交换，避免了拷贝构造抛异常导致的数据丢失。

### 2. 劣势与隐藏缺陷（饥饿风险）
- **高并发下的内存回收饥饿（Memory Reclamation Starvation）**：
  上述延迟删除机制有一个著名的潜在缺陷——如果在超高并发负载下，始终源源不断地有线程进入 `pop()`，导致 `threads_in_pop` 计数**长期大于 1（永远无法降到 0）**，那么 `to_be_deleted` 待删除链表就会像滚雪球一样无限膨胀，迟迟得不到清理，最终可能耗尽系统内存！
- **高竞争下的 CAS 自旋开销**：所有线程都在争夺同一个 `head` 原子指针，在核心数极多时缓存一致性协议（MESI）的缓存行失效开销较大。
- **工业界更优解**：为了解决延迟删除链表在持续高并发下无法释放的问题，工业级无锁数据结构通常会采用 **风险指针（Hazard Pointers）** 或 **基于纪元的内存回收（Epoch-Based Reclamation, EBR）**。

---

## 个人困惑

> 本节针对学习无锁栈与延迟删除链表过程中遇到的核心底层疑问进行深度剖析。

### 1. 原子变量 `threads_in_pop` 没有用 `static` 修饰，会不会导致不同线程中的值不一样？如果不是多线程共享，岂不是无法统计当前操作的线程数量？

::: details 展开详细解答：成员变量 vs 局部变量、内存布局与为何绝对不能加 static
**简答：**不会导致不同线程看到的值不一样！`threads_in_pop` **本身就是多线程共享的**，而且这里**绝对不能**加 `static` 关键字。

#### 1. 区分“类的非静态成员变量”与“函数局部变量”
在 C++ 中，变量是否被多线程共享，取决于它存储的内存区域，而不是有没有加 `static`：
- **函数局部变量（Thread-Local on Stack）**：如果把变量定义在 `pop()` 函数内部，那么每个线程调用 `pop()` 时都会在各自独立的**线程栈（Thread Stack）**上创建一份副本，线程之间互不可见。
- **类的成员变量（Member Variable）**：`std::atomic<unsigned> threads_in_pop;` 是定义在 `class lock_free_stack` 内部的成员变量。当你实例化一个对象 `lock_free_stack<int> lk_free_stack;` 时，这个对象占据一块固定的内存空间（包含 `head`、`threads_in_pop`、`to_be_deleted` 三个成员）。

当线程 1、线程 2、线程 3 同时调用**同一个 `lk_free_stack` 对象**的 `pop()` 时，它们访问的都是 `this->threads_in_pop`，指向的是**同一块物理内存地址**！

```text
线程 1 (运行 pop) ──┐
线程 2 (运行 pop) ──┼──► 访问同一块对象内存: lk_free_stack.threads_in_pop
线程 3 (运行 pop) ──┘
```

#### 2. 为什么这里绝对不能加 `static` 关键字？
如果给 `threads_in_pop` 加上 `static`，它会变成**类级别（全局）共享**的静态变量，所有 `lock_free_stack` 实例都会共用这同一个计数器！
- 假设你的程序创建了两个互不相干的无锁栈：`stackA` 和 `stackB`。
- 线程 1 正在 `pop` `stackA`，线程 2 正在 `pop` `stackB`。
- 如果加了 `static`，`threads_in_pop` 的值会变成 `2`，导致两个栈互相干扰对方的内存回收时机，甚至引发更严重的并发逻辑混乱。

#### 3. 原子类型如何保证多线程下计数的准确性？
正因为 `threads_in_pop` 是 `std::atomic<unsigned>` 类型，所有操作同一个栈实例的线程在执行 `++threads_in_pop` 和 `--threads_in_pop` 时，底层都会通过 CPU 的硬件级原子指令（如 x86 下的 `LOCK XADD`）以及缓存一致性协议，保证所有线程看到的都是全局最新、严格准确的活跃线程总数。
:::

---

## 本例主线脉络

```text
                                 调用 pop()
                                     │
                                     ▼
                         [ ++threads_in_pop ] (登记活跃读者)
                                     │
                                     ▼
                     [ CAS 循环原子弹出 old_head ]
                                     │
                                     ▼
                       [ res.swap(old_head->data) ]
                                     │
                                     ▼
                         [ try_reclaim(old_head) ]
                                     │
                  ┌──────────────────┴──────────────────┐
                  ▼                                     ▼
       【threads_in_pop == 1】               【threads_in_pop > 1】
       当前仅有本线程在执行 pop               有其他线程正在并发 pop
                  │                                     │
                  ▼                                     ▼
   接管全局链表: to_be_deleted.exchange(nullptr)  将 old_head 头插挂入
                  │                               to_be_deleted 延迟链表
                  ▼                                     │
         [ !--threads_in_pop ]                          ▼
          ├── 是 (无新线程闯入) ──► 释放整条链表    [ --threads_in_pop ]
          └── 否 (有新线程闯入) ──► 重新挂回链表
                  │
                  ▼
          [ delete old_head ] (本线程独占节点，安全销毁)
```

**一句话总结：无锁栈通过 CAS 解决指针竞争，借助 `std::shared_ptr` 保障异常安全，并利用原子计数器与延迟删除链表实现了“无人并发读时集中回收，有人并发读时暂存挂起”的安全内存管理闭环。**

## 完整代码的位置
::: tip
/home/ycx/Code/thred_learning/18_LockFreeStack
:::