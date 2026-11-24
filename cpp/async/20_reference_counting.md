# 基于引用计数的无锁并发栈（Reference Counting）

> 本文整理自博主截图，并结合个人困惑中的 4 个问题重新组织。
>
> **阅读重点：**这套实现不是简单地“给节点加一个原子引用计数”就能解决并发释放问题。真正关键的是：先通过原子操作安全地取得节点的外部引用，再把竞争失败的引用结算到节点内部计数中，最终判断节点是否可以释放。

---

## 目录

- [1. 为什么需要基于引用计数的无锁栈](#1-为什么需要基于引用计数的无锁栈)
- [2. 第一版：单一引用计数为什么不够](#2-第一版单一引用计数为什么不够)
- [3. 第二版：把引用计数与节点指针解耦](#3-第二版把引用计数与节点指针解耦)
- [4. 改进版的数据结构](#4-改进版的数据结构)
- [5. push：入栈过程](#5-push入栈过程)
- [6. pop：出栈过程逐步拆解](#6-pop出栈过程逐步拆解)
- [7. 两种引用计数如何配合](#7-两种引用计数如何配合)
- [8. 并发时序分析](#8-并发时序分析)
- [9. 测试与验证](#9-测试与验证)
- [10. 个人困惑](#10-个人困惑)
- [11. 个人总结与复习清单](#11-个人总结与复习清单)

---

## 1. 为什么需要基于引用计数的无锁栈

前面学习的风险指针（Hazard Pointers）通过全局风险指针数组登记每个线程正在访问的节点。它可以安全地延迟回收节点，但需要：

1. 线程取得自己的风险指针槽位；
2. 访问节点前登记地址，并重新读取 `head` 进行校验；
3. 节点弹出后扫描风险指针数组；
4. 如果仍有人保护该节点，就放入待回收链表；
5. 后续还要再次扫描待回收链表。

这种方式的主要开销是：需要反复扫描风险指针数组，以及维护待回收链表。

基于引用计数的思路是：

- 用**外部引用计数**表示当前有多少个线程通过栈顶状态取得了某个节点的外部访问权；
- 用**内部引用计数**结算那些已经取得外部引用、但最终没有成功弹出节点的线程；
- 当外部引用和内部引用结算后，节点的有效引用数变为 0，就可以释放节点。

这里的重点不是“所有线程都去随意修改同一个计数器”，而是让**栈顶指针与外部计数作为一个整体参与 CAS**，并让内部计数以原子方式汇总竞争线程的结算结果。

---

## 2. 第一版：单一引用计数为什么不够

### 2.1 初始数据结构

博主先尝试把数据、下一个节点指针和引用计数都放在同一个节点中：

```cpp
template<typename T>
class single_ref_stack {
private:
    struct ref_node {
        std::shared_ptr<T> _data;
        std::atomic<int> _ref_count;
        ref_node* _next;

        ref_node(T const& data)
            : _data(std::make_shared<T>(data)),
              _ref_count(1),
              _next(nullptr) {}
    };

    std::atomic<ref_node*> head;
};
```

其中：

| 成员 | 含义 |
|---|---|
| `_data` | 节点保存的数据 |
| `_ref_count` | 节点引用计数 |
| `_next` | 下一个节点 |
| `head` | 指向当前栈顶节点的原子指针 |

### 2.2 push

```cpp
void push(T const& data) {
    auto* new_node = new ref_node(data);
    new_node->_next = head.load();

    while (!head.compare_exchange_weak(
        new_node->_next, new_node)) {
    }
}
```

过程：

1. 创建新节点；
2. 让新节点的 `_next` 指向当前栈顶；
3. CAS 尝试把 `head` 更新为新节点；
4. 如果其他线程同时修改了 `head`，CAS 失败会更新 `new_node->_next`，然后重试。

### 2.3 单一引用计数版 pop 的核心问题

典型思路如下（用于说明问题，不建议作为最终实现）：

```cpp
std::shared_ptr<T> pop() {
    ref_node* old_head = head.load();

    for (;;) {
        if (!old_head) {
            return {};
        }

        ++old_head->_ref_count;

        if (head.compare_exchange_strong(
                old_head, old_head->_next)) {

            std::shared_ptr<T> res;
            res.swap(old_head->_data);

            // 尝试扣除 head 原有引用和当前 pop 的引用
            int old_count = old_head->_ref_count.fetch_sub(2);

            if (old_count == 2) {
                delete old_head;
            }

            return res;
        } else {
            if (old_head->_ref_count.fetch_sub(1) == 1) {
                delete old_head;
            }
        }
    }
}
```

### 2.4 问题一：读取指针与增加引用计数之间存在危险窗口

假设：

```text
head ──> A ──> B
```

线程 1 和线程 2 都执行：

```cpp
ref_node* old_head = head.load();
```

两者都得到 A 的地址。

可能发生：

1. 线程 2 读取 A 的地址后暂停，尚未增加 A 的引用计数；
2. 线程 1 成功把 `head` 从 A 更新为 B；
3. 线程 1 认为 A 已经没有其他引用，释放 A；
4. 线程 2 恢复，执行 `++old_head->_ref_count`；
5. 线程 2 正在访问已经释放的内存，产生 use-after-free。

**原子引用计数只能保证“对一个仍然存活的计数器进行原子加减”，不能保证拿到计数器地址之后，该计数器对象一定还活着。**

这就是为什么不能简单地先 `head.load()`，再对裸指针指向的计数器加 1。

### 2.5 问题二：CAS 失败会改写 expected 指针，导致结算对象错位

假设线程 1、线程 2 都拿到 A：

```text
head ──> A ──> B

T1.old_head ──> A
T2.old_head ──> A
```

线程 1 成功弹出 A：

```text
head ──> B
```

线程 2 随后执行：

```cpp
head.compare_exchange_strong(old_head, old_head->_next);
```

CAS 失败时，`old_head` 会被写成当前 `head` 的值，也就是 B：

```text
T2.old_head ──> B
```

如果接下来仍然执行：

```cpp
old_head->_ref_count.fetch_sub(1);
```

那么减少的是 B 的引用计数，而不是线程 2 最初尝试保护的 A。

这会产生两类风险：

- 如果代码根据 B 的计数决定删除，却删除了 A 或其他对象，就可能误删；
- 如果 A 的引用计数已经增加，但失败后没有对 A 做对应的减法，就可能让 A 的计数残留，造成内存泄漏。

**CAS 失败后，expected 会更新；因此不能再假设它仍然指向最初尝试保护的节点。**

---

## 3. 第二版：把引用计数与节点指针解耦

为了让栈顶状态中的引用计数能够与节点指针一起参与 CAS，博主尝试把原来的节点拆成两个结构：

- `node`：真正保存数据、下一节点和内部计数；
- `ref_node`：保存外部引用计数以及指向实际节点的指针。

### 3.1 拆分后的结构

```cpp
struct node;

struct ref_node {
    std::atomic<int> _ref_count;
    node* _node_ptr;
};

struct node {
    std::shared_ptr<T> _data;
    ref_node* _next;
};

std::atomic<ref_node*> head;
```

这版的出发点是：

- `ref_node` 负责引用计数；
- `node` 负责真正的数据；
- 通过分离结构，试图让引用计数与节点释放相互独立。

但是，**仅仅把结构体拆开，并没有解决问题。**

### 3.2 为什么指针版仍然存在问题

假设代码这样写：

```cpp
ref_node* old_head = head.load();
ref_node* new_head;

do {
    new_head = old_head;
    new_head->_ref_count += 1;
} while (!head.compare_exchange_weak(old_head, new_head));
```

这里：

```cpp
new_head = old_head;
```

只是复制地址：

```text
old_head ──┐
           ├──> 同一个 ref_node 对象
new_head ──┘
```

因此：

```cpp
new_head->_ref_count += 1;
```

直接修改的是共享 `ref_node` 对象中的计数器，并不是构造一个带有新计数值的独立 CAS 候选对象。

这与下面的值类型写法完全不同：

```cpp
ref_node new_head = old_head;
++new_head._ref_count;
```

后者复制的是整个结构体的值，修改 `new_head._ref_count` 不会直接修改 `old_head` 所指向的对象。

### 3.3 指针版的根本缺陷

即使 `_ref_count` 是 `std::atomic<int>`，也只保证计数器的单次读写原子化，不能保证：

```text
增加某个节点的引用计数
+
确认 head 仍然指向这个节点
```

这两个动作作为一个整体成功。

可能发生：

1. 线程 2 对 A 的引用计数执行 `+1`；
2. 线程 1 已经把 `head` 从 A 更新为 B；
3. 线程 2 的 CAS 失败，`old_head` 被改写为 B；
4. 线程 2 后续重试时开始操作 B；
5. 线程 2 没有撤销此前对 A 的 `+1`；
6. 线程 1 结算 A 时发现仍有一个引用，因而不释放 A。

这就是前面讨论过的**引用计数残留导致的内存泄漏**。

所以，真正需要改变的是 `head` 的类型，而不只是把结构体拆开。

---

## 4. 改进版的数据结构

### 4.1 核心设计

改进方案将 `head` 改为：

```cpp
std::atomic<ref_node> head;
```

注意：这里的 `ref_node` 是一个结构体值，不是 `ref_node*`。

`ref_node` 包含两个字段：

```cpp
struct ref_node {
    int _ref_count;  // 外部引用计数
    node* _node_ptr; // 实际节点地址
};
```

而真正的 `node` 包含：

```cpp
struct node {
    std::shared_ptr<T> _data;
    ref_node _next;                 // 下一个栈顶状态的值
    std::atomic<int> _dec_count;    // 内部引用计数结算值
};
```

完整结构如下：

```cpp
template<typename T>
class single_ref_stack {
private:
    struct node;

    // head 中保存的值：外部引用计数 + 实际节点指针
    struct ref_node {
        int _ref_count;
        node* _node_ptr;
    };

    // 真正的节点
    struct node {
        std::shared_ptr<T> _data;
        ref_node _next;
        std::atomic<int> _dec_count;

        explicit node(T const& data)
            : _data(std::make_shared<T>(data)),
              _next{0, nullptr},
              _dec_count(0) {}
    };

    // 原子地保存整个 ref_node 值
    std::atomic<ref_node> head;

public:
    single_ref_stack() {
        // C++11/14 兼容写法：先默认构造 atomic，再 store 初始值
        head.store(ref_node{0, nullptr}, std::memory_order_relaxed);
    }

    bool is_lock_free() const noexcept {
        return head.is_lock_free();
    }

    ~single_ref_stack() {
        while (pop()) {
        }
    }

    single_ref_stack(single_ref_stack const&) = delete;
    single_ref_stack& operator=(single_ref_stack const&) = delete;

    void push(T const& data);

    std::shared_ptr<T> pop();
};
```

### 4.2 两个计数器分别是什么？

| 计数器 | 所在位置 | 类型 | 主要职责 |
|---|---|---|---|
| `_ref_count` | `ref_node` | 普通 `int` | 记录 head 状态中的外部引用数量 |
| `_dec_count` | `node` | `std::atomic<int>` | 汇总并发线程对节点的内部引用结算 |

注意：`_dec_count` 允许为负数。它不是传统意义上“永远从 0 往上增加的引用数量”，而是用于抵消外部引用的内部计数调整值。

### 4.3 为什么 `head` 要保存结构体，而不是指针？

```cpp
std::atomic<ref_node> head;
```

现在 CAS 操作比较和交换的是整个 `ref_node`：

```text
_ref_count + _node_ptr
```

例如：

```text
旧值：{ external_count = 2, ptr = A }
新值：{ external_count = 3, ptr = A }
```

CAS 成功时，两个字段作为一个整体更新。

其他线程不能只看到“计数已经增加”，却看不到对应的指针状态；也不会出现只更新了计数、但 CAS 没成功的情况。

这正是改进版的核心。

---

## 5. push：入栈过程

```cpp
void push(T const& data) {
    ref_node new_node;

    new_node._node_ptr = new node(data);
    new_node._ref_count = 1;

    // 新节点的 next 保存当前 head 的完整状态
    new_node._node_ptr->_next = head.load(std::memory_order_relaxed);

    // CAS 失败时，expected 参数会被更新为最新 head，
    // 因而 next 也会随之更新，然后继续重试
    while (!head.compare_exchange_weak(
        new_node._node_ptr->_next,
        new_node,
        std::memory_order_release,
        std::memory_order_relaxed)) {
    }
}
```

### 执行过程

假设原来：

```text
head = {1, A}
```

准备压入节点 B：

1. 创建实际节点 B；
2. 设置 `B.next = {1, A}`；
3. 构造新栈顶状态 `{1, B}`；
4. CAS 尝试把 `head` 从 `{1, A}` 改为 `{1, B}`；
5. 如果 CAS 失败，`B.next` 会被更新为最新的 `head`，重新尝试。

这里初始外部计数设为 1，表示新节点成为栈顶后，栈顶本身持有一个外部引用。

---

## 6. pop：出栈过程逐步拆解

### 6.1 完整代码

```cpp
std::shared_ptr<T> pop() {
    ref_node old_head = head.load(std::memory_order_relaxed);

    for (;;) {
        // 先判断空栈，避免对空 head 的外部计数反复增加
        if (!old_head._node_ptr) {
            return {};
        }

        // 1. 增加外部引用计数，并通过 CAS 将其提交到 head
        ref_node new_head;

        do {
            new_head = old_head;
            ++new_head._ref_count;
        } while (!head.compare_exchange_weak(
            old_head,
            new_head,
            std::memory_order_acquire,
            std::memory_order_relaxed));

        // CAS 成功时 expected 不会自动变成 desired，
        // 因此本地 old_head 的外部计数也要同步更新
        old_head._ref_count = new_head._ref_count;

        // 2. 保存实际节点指针
        node* const node_ptr = old_head._node_ptr;

        // 3. 尝试将 head 更新为下一个节点
        if (head.compare_exchange_strong(
                old_head,
                node_ptr->_next,
                std::memory_order_relaxed)) {

            // 4. 取出数据
            std::shared_ptr<T> res;
            res.swap(node_ptr->_data);

            // 5. 计算需要转移到内部计数的引用数量
            int const increase_count = old_head._ref_count - 2;

            // 6. 结算内部引用计数
            if (node_ptr->_dec_count.fetch_add(
                    increase_count,
                    std::memory_order_release) == -increase_count) {
                delete node_ptr;
            }

            return res;
        } else {
            // 7. CAS 失败：当前线程没有弹出这个节点，
            // 需要撤销自己对原节点取得的外部引用
            if (node_ptr->_dec_count.fetch_sub(
                    1,
                    std::memory_order_relaxed) == 1) {

                node_ptr->_dec_count.load(std::memory_order_acquire);
                delete node_ptr;
            }
        }
    }
}
```

> **代码说明：**这里采用的是截图中的“外部计数 + 内部计数”算法。为了避免空栈时不断增加空 `head` 的外部计数，代码把空栈检查放在外部计数增加之前。该代码仍要求 `head` 的原子操作、内存序和对象生命周期满足相应平台与 C++ 标准要求，不能仅凭示例代码就认定所有平台都提供硬件无锁实现。

### 6.2 第 1 步：为什么先增加外部引用计数？

```cpp
do {
    new_head = old_head;
    ++new_head._ref_count;
} while (!head.compare_exchange_weak(
    old_head, new_head,
    std::memory_order_acquire,
    std::memory_order_relaxed));
```

假设：

```text
head = {1, A}
```

当前线程先构造一个局部副本：

```text
old_head = {1, A}
new_head = {2, A}
```

然后 CAS：

```text
{1, A} → {2, A}
```

只有 CAS 成功，才真正把外部引用计数增加到全局 `head` 中。

如果失败：

- 全局 `head` 不会因为这次失败而增加；
- `old_head` 会被更新为最新的 `head`；
- 下一轮重新复制 `old_head`，再增加计数；
- 不会留下“CAS 失败，但共享节点计数已经增加”的残留。

### 6.3 第 2 步：为什么要单独保存 `node_ptr`？

```cpp
node* const node_ptr = old_head._node_ptr;
```

这里保存的是实际节点地址。

后面执行：

```cpp
head.compare_exchange_strong(old_head, node_ptr->_next)
```

如果 CAS 失败，`old_head` 会被改写为最新的 `head`。

但 `node_ptr` 不会改变，仍然指向本次已经取得外部引用保护的原节点。

因此，失败分支必须使用：

```cpp
node_ptr->_dec_count.fetch_sub(1);
```

而不能通过被 CAS 改写的 `old_head` 去寻找原节点。

这也是改进版避免“减少错对象计数”的关键。

### 6.4 第 3 步：谁有权真正弹出节点？

```cpp
if (head.compare_exchange_strong(
        old_head,
        node_ptr->_next))
```

多个线程可能同时取得同一个节点的外部引用，但只有一个线程能够成功把 `head` 从当前节点更新到下一个节点。

- CAS 成功：当前线程是赢家，负责取出数据；
- CAS 失败：当前线程是输家，没有弹出节点，需要撤销自己取得的那份外部引用。

### 6.5 第 4 步：为什么成功后要减 2？

```cpp
int const increase_count = old_head._ref_count - 2;
```

成功弹出时，需要从外部引用计数中扣除：

1. 栈顶 `head` 原本持有的 1 份引用；
2. 当前赢家线程为本次 `pop()` 增加的 1 份引用。

因此要减去 2。

剩余的外部引用数量：

```cpp
increase_count = old_head._ref_count - 2;
```

这些引用来自其他已经成功增加外部引用、但还没有完成本次竞争结算的线程。

它们需要转移到节点的内部计数中。

### 6.6 第 5 步：为什么使用 `fetch_add`？

```cpp
if (node_ptr->_dec_count.fetch_add(
        increase_count,
        std::memory_order_release) == -increase_count) {
    delete node_ptr;
}
```

`fetch_add(x)` 有两个效果：

- 将原子变量增加 `x`；
- 返回增加之前的旧值。

判断：

```cpp
old_value == -increase_count
```

意味着：

```text
old_value + increase_count == 0
```

也就是内部计数结算后归零，可以释放节点。

### 6.7 第 6 步：失败线程为什么 `fetch_sub(1)`？

```cpp
if (node_ptr->_dec_count.fetch_sub(
        1,
        std::memory_order_relaxed) == 1) {
    node_ptr->_dec_count.load(std::memory_order_acquire);
    delete node_ptr;
}
```

CAS 失败的线程已经成功增加过一次外部引用，但没有成功弹出节点。

因此它要对自己原先保护的节点撤销 1 份引用。

如果 `fetch_sub(1)` 返回 1，说明：

```text
原值 = 1
减 1 后 = 0
```

当前线程是最后一个完成引用结算的线程，由它负责释放节点。

这里使用 `node_ptr`，而不是 `old_head._node_ptr`，是为了避免 CAS 失败后 `old_head` 已经被改写的问题。

---

## 7. 两种引用计数如何配合

### 7.1 外部引用计数 `_ref_count`

它位于 `ref_node` 中，并作为 `head` 原子值的一部分。

它主要表示：

- 栈顶本身持有的引用；
- 各个 `pop()` 线程通过 CAS 成功取得的外部引用。

它的变化不是由线程直接修改共享节点对象中的字段，而是通过构造一个新的 `ref_node` 值，再 CAS 更新整个 `head`。

### 7.2 内部引用计数 `_dec_count`

它位于实际 `node` 中：

```cpp
std::atomic<int> _dec_count;
```

它主要负责结算：

- 赢得弹出权的线程把剩余外部引用转移过来的数量；
- CAS 失败线程撤销自己外部引用时的减量。

因此它可能出现负数。

### 7.3 为什么内部计数可以为负数？

假设：

- 初始 `_dec_count = 0`；
- 有两个线程成功取得同一个节点的外部引用；
- 线程 1 赢得弹出权；
- 线程 2 CAS 失败。

如果线程 2 先执行：

```cpp
_dec_count.fetch_sub(1);
```

内部计数会变成：

```text
0 → -1
```

随后线程 1 执行：

```cpp
increase_count = 1;
_dec_count.fetch_add(1);
```

内部计数变成：

```text
-1 → 0
```

`fetch_add(1)` 返回旧值 `-1`，恰好等于 `-increase_count`，因此线程 1 可以释放节点。

反过来，如果线程 1 先加 1：

```text
0 → 1
```

线程 2 再减 1：

```text
1 → 0
```

线程 2 的 `fetch_sub(1)` 返回 1，也会负责释放节点。

**无论结算顺序如何，最终只有一个线程会观察到“自己这次原子操作使计数归零”，从而承担释放责任。**

---

## 8. 并发时序分析

### 8.1 场景一：两个线程都取得外部引用，线程 1 成功弹出

初始：

```text
head = {1, A}
A._dec_count = 0
```

线程 1、线程 2 依次通过外部引用计数 CAS：

| 时刻 | 操作 | head 的外部计数 |
|---|---|---:|
| 初始 | A 在栈顶 | 1 |
| T1 | T1 增加外部引用 | 2 |
| T2 | T2 增加外部引用 | 3 |
| T1 | T1 成功弹出 A | A 脱离 head |
| T1 | `increase_count = 3 - 2` | 1 |

此时：

```cpp
A._dec_count.fetch_add(1);
```

如果返回 0，内部计数变为 1，暂时不能删除。

线程 2 的弹出 CAS 失败后：

```cpp
A._dec_count.fetch_sub(1);
```

如果返回 1，内部计数变为 0，线程 2 负责删除 A。

### 8.2 场景二：失败线程先结算，内部计数先变为负数

初始：

```text
A._dec_count = 0
increase_count = 1
```

执行顺序：

| 顺序 | 线程 | 操作 | `_dec_count` |
|---|---|---|---:|
| 1 | T2 | CAS 失败，`fetch_sub(1)` | 0 → -1 |
| 2 | T1 | CAS 成功后，`fetch_add(1)` | -1 → 0 |

线程 1 的 `fetch_add(1)` 返回 -1：

```cpp
-1 == -increase_count
```

成立，因此线程 1 删除节点。

### 8.3 场景三：两个线程同时竞争时，为什么不会因为失败的 CAS 留下外部计数？

改进版增加外部引用时：

```cpp
new_head = old_head;
++new_head._ref_count;

head.compare_exchange_weak(old_head, new_head);
```

计数只修改本地副本 `new_head`。

因此：

- CAS 成功：整个 `{_ref_count, _node_ptr}` 状态更新到 `head`；
- CAS 失败：`head` 不变，`old_head` 被更新为最新值；
- 下一轮重新构造候选值。

这与指针版直接执行：

```cpp
new_head->_ref_count += 1;
```

完全不同。后者会提前修改共享对象，CAS 失败也无法自动撤销这次修改。

---

## 9. 测试与验证

博主使用一个生产者和两个消费者进行测试：

- 生产者压入 20000 个元素；
- 消费者 1 成功弹出 10000 个元素；
- 消费者 2 成功弹出 10000 个元素；
- 使用 `std::set<int>` 记录弹出的值；
- 最后断言集合大小为 20000。

简化测试示例：

```cpp
#include <cassert>
#include <iostream>
#include <mutex>
#include <set>
#include <thread>
#include <chrono>

void test_single_ref_stack() {
    single_ref_stack<int> stack;

    std::set<int> result;
    std::mutex result_mutex;

    std::thread producer([&] {
        for (int i = 0; i < 20000; ++i) {
            stack.push(i);
            std::this_thread::sleep_for(
                std::chrono::microseconds(5));
        }
    });

    auto consumer = [&](int count) {
        for (int i = 0; i < count;) {
            auto value = stack.pop();

            if (!value) {
                std::this_thread::yield();
                continue;
            }

            {
                std::lock_guard<std::mutex> lock(result_mutex);
                result.insert(*value);
            }

            ++i;
        }
    };

    std::thread consumer1(consumer, 10000);
    std::thread consumer2(consumer, 10000);

    producer.join();
    consumer1.join();
    consumer2.join();

    assert(result.size() == 20000);
    std::cout << "all values popped exactly once\n";
}
```

### 测试能说明什么？

如果断言通过，说明这次测试中：

- 成功弹出的元素数量符合预期；
- 没有重复值导致集合大小减少；
- 没有丢失元素。

但它不能单独证明算法在所有并发时序下都正确。

建议进一步使用：

- ThreadSanitizer 检查数据竞争；
- AddressSanitizer 检查 use-after-free、double-free；
- 多轮随机并发压力测试；
- 对每个输入值验证恰好弹出一次。

另外，`std::atomic<ref_node>` 不保证在所有平台上都是硬件无锁的。应检查：

```cpp
std::cout << std::boolalpha
          << stack.is_lock_free() << '\n';
```

某些平台可能需要额外链接原子运行库，例如 GCC 环境中的 `-latomic`。

---

## 10. 个人困惑

### 问题 1：为什么指针版中，线程 2 CAS 失败后可能误删节点？

**问题原意：**

线程 1 先执行 CAS，将 `head` 更新为下一个节点 B。线程 2 的 CAS 失败，`old_head` 被更新为新的 `head`，此时它的引用计数为 1，于是进入删除逻辑。

**关键：CAS 失败会改写 expected。**

假设原来：

```text
head ──> A ──> B

T2.old_head ──> A
```

线程 1 弹出 A 后：

```text
head ──> B
```

线程 2 执行：

```cpp
head.compare_exchange_strong(old_head, old_head->_next);
```

失败后：

```text
T2.old_head ──> B
```

如果失败分支写的是：

```cpp
if (old_head->_ref_count.fetch_sub(1) == 1) {
    delete old_head;
}
```

那么减少的是 B 的计数，删除的也是 B。

这里必须区分截图中的两种写法：

**写法 A：第一版中直接删除 `old_head`**

```cpp
if (old_head->_ref_count.fetch_sub(1) == 1) {
    delete old_head;
}
```

CAS 失败后，`old_head` 已经被改写为 B，因此这段代码可能减少 B 的计数，并在计数原值为 1 时删除 B。可是 B 仍然是 `head` 指向的栈顶，`head` 并没有被这次失败的 CAS 修改，于是留下悬空栈顶，其他线程访问时可能崩溃。

**写法 B：拆分结构的指针版中删除 `node_ptr`**

```cpp
if (old_head->_ref_count.fetch_sub(1) == 1) {
    delete node_ptr;
}
```

这里 `old_head` 可能已经指向 B，但 `node_ptr` 仍然保存最初实际节点 A 的地址。因此条件检查的是 B 的计数，删除的却是 A。它同样是“用一个节点的计数决定另一个节点的释放”，结算对象错位；可能造成 A 被重复释放或过早释放，也可能让 A 的引用结算残留。

所以你原来的理解“后到线程可能误删新节点，而且没有成功弹出它”对应写法 A；对于截图中 `delete node_ptr` 的写法 B，准确说法是：**用新栈顶 B 的计数来决定是否删除旧节点 A**。

**共同根因：CAS 失败改写了 `old_head`，但代码仍把它当成最初尝试保护的节点。**

---

### 问题 2：线程 2 后来操作新的栈顶，并成功删除新节点，这种情况正常吗？

**先区分两种时序。**

这里需要把博主描述的时间点再说精确一点。

#### 情况 A：线程 2 只执行了 `head.load()`，还没有增加 A 的引用计数

```cpp
ref_node* old_head = head.load(); // 得到 A
```

线程 2 暂停。线程 1 弹出并释放 A：

```text
head ──> B
A 已经释放
```

线程 2 恢复后，如果执行：

```cpp
++old_head->_ref_count;
```

它访问的是已经释放的 A，属于 use-after-free。

**因此，“线程 1 已经删除 A，线程 2 才执行增加 A 的引用计数，然后 old_head 自动变成 B”是不可能安全成立的。**裸指针不会自动刷新，CAS 也还没有执行，当然没有机会改写 expected。

#### 情况 B：线程 2 已经先增加了 A 的引用计数，然后暂停

假设 A 的初始计数为 1：

1. 线程 2 对 A 增加 1，计数变成 2，然后暂停；
2. 线程 1 对 A 增加 1，计数变成 3；
3. 线程 1 成功把 `head` 从 A 更新为 B；
4. 线程 1 扣除 `head` 原有引用和自己的引用，即减 2，A 的计数从 3 变成 1，因此不能删除 A；
5. 线程 2 恢复，尝试用 A 做 CAS，失败后 `old_head` 被更新为 B；
6. 线程 2 下一轮针对 B 重试。

这个情况下，线程 2 先前增加的 A 引用确实阻止了线程 1 过早删除 A；但线程 2 必须正确地对 A 做一次减 1 结算，才能让 A 最终释放。

**但截图中的指针版重试循环并没有做到这件事。**它在 CAS 失败后把 `old_head` 改成 B，然后下一轮改为增加 B 的计数；原先对 A 增加的那一份计数没有被撤销。因此，这条路径并不能简单地称为“正常”。

这实际上与问题 3 是同一个漏洞：线程 2 可以继续尝试弹出 B，但 A 的引用计数可能残留，最终造成 A 泄漏。

#### 结论

博主说的“线程 2 后来操作下一个节点并成功弹出”只描述了它可能继续推进栈顶，并没有证明内存回收正确。若线程 2 只读取了裸指针、尚未增加引用计数，线程 1 就释放了 A，那么线程 2 后续访问 A 是 use-after-free；若线程 2 已经增加 A 的计数，失败后又转向 B，却没有结算 A，则会造成引用计数残留。

**不能把“CAS 失败会更新 expected”理解成“普通指针会自动刷新”。**

---

### 问题 3：为什么线程 2 增加了 A 的引用计数，最后却可能造成 A 内存泄漏？

这是你之前反复推演的那个场景。

假设：

```text
head ──> A ──> B
A._ref_count = 2
```

线程 1 已经成功弹出 A，并执行了：

```cpp
res.swap(node_ptr->_data);
```

此时线程 1 准备执行引用计数结算：

```cpp
node_ptr->_ref_count.fetch_sub(2);
```

线程 2 抢占 CPU，执行：

```cpp
new_head = old_head;
new_head->_ref_count += 1;
```

由于 `new_head` 和 `old_head` 是两个指向 A 的指针，这一步直接修改了 A 的共享计数：

```text
A._ref_count: 2 → 3
```

随后线程 2 执行 CAS：

```cpp
head.compare_exchange_weak(old_head, new_head);
```

由于线程 1 已经把 `head` 更新为 B，CAS 失败：

```text
head ──> B
T2.old_head ──> B
```

线程 2 后续重试，开始操作 B。

此时线程 1 执行：

```cpp
node_ptr->_ref_count.fetch_sub(2);
```

原值为 3，减 2 后变为 1：

```text
A._ref_count: 3 → 1
```

因此线程 1 不会删除 A。

但线程 2 已经转而操作 B，没有再对 A 执行对应的 `fetch_sub(1)`。

最终：

```text
A 已经脱离栈
A._ref_count = 1
没有线程再负责结算 A 的残留计数
```

于是 A 可能永久无法释放，造成内存泄漏。

**根本原因：对 A 的计数增加已经修改了共享对象，但增加操作对应的 CAS 却失败了；失败后又没有撤销 A 的计数。**

改进版通过先修改本地 `ref_node` 副本，再用 `std::atomic<ref_node>` 对整个值做 CAS，解决了这个问题。

---

### 问题 4：为什么外部计数 `_ref_count` 使用普通 `int`，内部计数 `_dec_count` 使用 `std::atomic<int>`？

这是整个数据结构设计中很重要的一点。

#### 1. 外部计数为什么可以是普通 `int`？

```cpp
struct ref_node {
    int _ref_count;
    node* _node_ptr;
};

std::atomic<ref_node> head;
```

虽然 `_ref_count` 是普通 `int`，但它不是被多个线程直接并发读写的共享计数器。

它属于 `head` 这个原子对象保存的整体值。

线程修改它时，实际做的是：

```cpp
ref_node new_head = old_head;
++new_head._ref_count;

head.compare_exchange_weak(old_head, new_head);
```

每个线程修改的是自己的局部副本。

只有 CAS 成功时，整个结构体才会原子地更新到 `head` 中。

所以这里不需要再把 `_ref_count` 单独声明成 `std::atomic<int>`。

#### 2. 内部计数为什么必须是原子的？

```cpp
struct node {
    std::atomic<int> _dec_count;
};
```

因为多个线程可能同时持有同一个 `node*`，并且并发执行：

```cpp
node_ptr->_dec_count.fetch_add(...);
node_ptr->_dec_count.fetch_sub(...);
```

这些操作直接作用于同一个 `node` 对象中的成员。

因此必须使用原子变量，避免数据竞争，并保证并发增减不会相互覆盖。

#### 3. 对比总结

| 对比 | 外部计数 `_ref_count` | 内部计数 `_dec_count` |
|---|---|---|
| 所在位置 | `ref_node` | `node` |
| 数据形式 | `head` 中的整体值 | 共享节点中的成员 |
| 多线程修改方式 | 各自修改局部副本，再 CAS 更新 `head` | 多线程直接原子增减同一成员 |
| 是否需要 atomic | 不需要单独 atomic | 需要 atomic |
| 主要用途 | 记录外部引用 | 结算并发引用 |

**一句话：外部计数依靠 `std::atomic<ref_node>` 实现整体原子更新；内部计数由多个线程直接共同修改，所以自身必须是原子的。**

---

## 11. 个人总结与复习清单

### 11.1 整个设计的演进过程

```text
第一版：单一引用计数
    |
    | 先 load 裸指针，再增加节点内部计数
    | 可能在增加计数之前，节点已经被其他线程释放
    v
第二版：将 ref_node 与 node 拆开
    |
    | 但是 head 仍然是 atomic<ref_node*>
    | new_head = old_head 只是复制地址
    | 对共享计数的增加与 CAS 不属于一个原子操作
    v
第三版：head 改为 atomic<ref_node>
    |
    | ref_node = {外部计数, node*}
    | 先修改本地副本
    | CAS 原子更新整个 ref_node
    v
最终：外部计数 + 内部计数结算
    |
    | 赢家转移剩余外部引用
    | 输家撤销自己的引用
    | 有效引用归零时释放节点
```

### 11.2 最容易混淆的 6 个知识点

1. **指针赋值与对象复制不同。**

   `new_head = old_head` 如果两者都是指针，只是复制地址；如果两者是结构体对象，则复制结构体的值。

2. **原子计数器不等于安全的内存回收。**

   即使 `_ref_count` 是 `std::atomic<int>`，也不能保证读取到的裸指针指向的对象还活着。

3. **CAS 失败会修改 expected。**

   `compare_exchange_weak/strong(expected, desired)` 失败时会把原子对象的当前值写回 `expected`。

4. **CAS 成功不代表 expected 自动变成 desired。**

   成功时原子对象更新为 `desired`，但 `expected` 通常保持原值。因此需要时要显式更新本地副本。

5. **外部计数和内部计数不是两个互不相关的计数器。**

   它们共同完成引用结算：赢家把剩余外部引用转移到内部计数，输家逐个撤销自己的引用。

6. **内部计数允许为负数。**

   它表示尚未完成结算的引用差额，不是普通的“当前引用数量”。

### 11.3 复习时只记住这条主线

> **先通过 CAS 安全地增加外部引用，保证自己取得了节点的访问权；再竞争弹出栈顶；赢家把剩余外部引用转移到内部计数，输家撤销自己的一份引用；最后由使有效引用归零的线程释放节点。**

---

## 附：实现与平台注意事项

1. `std::atomic<ref_node>` 要求 `ref_node` 是可平凡复制类型。这里仅包含 `int` 和裸指针，满足这一要求。
2. `std::atomic<ref_node>` 不保证硬件无锁。应使用 `head.is_lock_free()` 检查；某些 GCC/Clang 环境可能需要链接 `libatomic`。
3. 这套算法依赖正确的内存序和对象生命周期管理。不要随意把 `acquire`、`release`、`relaxed` 全部替换成默认值或全部改成 `relaxed`。
4. 栈对象析构时必须确保没有其他线程仍在执行 `push()` 或 `pop()`。并发销毁容器本身不在此算法的保证范围内。
5. 测试通过不等于证明无锁算法正确。建议配合 ThreadSanitizer、AddressSanitizer 和压力测试。
6. `std::atomic<ref_node>` 的实现可能使用内部锁，因此“算法逻辑不使用互斥锁”和“整个实现一定 lock-free”是两件不同的事。

## 完整代码的位置
::: tip
/home/ycx/Code/thred_learning/20_reference_counting
:::
