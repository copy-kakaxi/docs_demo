# C++ STL 容器笔记：`std::list`

## 简介

`std::list` 的底层结构是**非连续的内存块（双向链表节点）**，节点之间通过指针相互连接。

::: warning 与 `vector` 的根本差异
因为内存不连续，`std::list` **绝对没有 `capacity()` 和 `reserve()` 函数**，也**绝对不支持 `[]` 运算符和 `at()` 函数**（不支持随机访问，不能写 `list[5]`）。
:::

---

## 一、构造函数

| 构造方式 | 形式 / 示例 | 说明与备注 |
| :--- | :--- | :--- |
| **默认构造** | `list<T> lst;` | 创建空链表。 |
| **指定大小构造** | `list<T> lst(n);` / `list<T> lst(n, value);` | 创建包含 `n` 个默认值（或 `value`）元素的链表。 |
| **范围构造** | `list<T> lst(first, last);` | 用 `[first, last)` 初始化。**注意：`list` 是双向迭代器，不支持 `+3` 等随机访问操作**，需直接给出具体迭代器位置。 |
| **拷贝构造** | `list<T> lst(other);` | 拷贝另一个 `list`。 |
| **移动构造（C++11）** | `list<T> lst(std::move(other));` | 转移节点所有权。 |
| **初始化列表构造（C++11）** | `list<T> lst{1, 2, 3, 4};` / `list<T> lst = {1, 2, 3, 4};` | 通过花括号初始化列表构造。 |
| **分配器参数构造** | `list<T> lst(alloc);` | 指定自定义内存分配器构造。 |

::: details 点击查看代码示例：构造函数
```cpp
#include <iostream>
#include <list>
#include <utility>

int main() {
    std::list<int> l1;                    // 默认构造
    std::list<int> l2(5, 10);             // 5 个 10
    std::list<int> l3 = {1, 2, 3, 4};     // 初始化列表
    std::list<int> l4(l3.begin(), l3.end()); // 范围构造
    std::list<int> l5(l3);                // 拷贝构造
    std::list<int> l6(std::move(l5));     // 移动构造

    for (int x : l6) std::cout << x << ' ';
    std::cout << '\n';
    return 0;
}
```
:::

---

## 二、成员函数：容量与访问（5 个）

| 函数名 | 作用 | 重点提示 |
| :--- | :--- | :--- |
| `front()` / `back()` | 返回首元素 / 尾元素的引用 | $O(1)$ 复杂度；空容器调用为未定义行为。 |
| `empty()` | 判断容器是否为空 | 空则返回 `true`。 |
| `size()` | 返回当前元素的个数 | C++11 之后，`list::size()` 强制要求为 $O(1)$ 复杂度（内部维护了计数器）。 |
| `resize(n, val)` | 改变容器的实际大小 | 变大则尾部用 `val` 填充节点；变小则销毁尾部多余节点。 |

::: details 点击查看代码示例：容量与访问
```cpp
#include <iostream>
#include <list>

int main() {
    std::list<int> l = {10, 20, 30};
    std::cout << "front=" << l.front() << ", back=" << l.back()
              << ", size=" << l.size() << ", empty=" << l.empty() << '\n';

    l.resize(5, 99); // {10, 20, 30, 99, 99}
    l.resize(2);     // {10, 20}
    return 0;
}
```
:::

---

## 三、成员函数：修改与增删 - 常规操作（10 个）

> **`list` 的最大优势**：只要拿到了正确位置的迭代器，插入和删除操作都是 $O(1)$ 复杂度，且**绝对不会发生像 `vector` 那样的“全局搬家扩容”**。

| 函数名 | 作用 | 重点提示 |
| :--- | :--- | :--- |
| `push_back(val)` / `pop_back()` | 在尾部添加 / 删除元素 | $O(1)$ 复杂度。 |
| `push_front(val)` / `pop_front()` | 在头部添加 / 删除元素 | **`vector` 没有的高效操作！** $O(1)$ 复杂度，非常适合做队列操作。 |
| `emplace_back(...)` / `emplace_front(...)` | 在尾部 / 头部直接原地构造元素 | 比 `push_xxx` 更高效，省去拷贝 / 移动开销。 |
| `insert(pos, val)` | 在迭代器 `pos` 指定的位置前插入 | **极其高效**，只需断开并重连几个指针，不需要像 `vector` 那样移动后面的元素。 |
| `erase(pos)` / `erase(first, last)` | 删除指定位置或区间的元素 | 改变 `size`；只需调整指针并释放被删节点内存，返回被删元素之后的迭代器。 |
| `clear()` | 清空所有元素 | 逐个遍历并释放所有节点的内存。 |
| `swap(list& other)` | 交换两个链表的内容 | 仅交换头尾指针等内部成员，$O(1)$。 |
| `assign(...)` | 覆盖容器的现有内容，设置为新值 | 支持 `(n, val)`、`(first, last)`、初始化列表。 |

::: details 点击查看代码示例：常规修改与增删
```cpp
#include <iostream>
#include <list>

int main() {
    std::list<int> l = {2, 3};
    l.push_front(1);      // {1, 2, 3}
    l.push_back(4);       // {1, 2, 3, 4}
    l.emplace_front(0);   // {0, 1, 2, 3, 4}

    auto it = l.begin();
    std::advance(it, 2);  // 双向迭代器不能写 it + 2，需用 std::advance
    l.insert(it, 99);     // {0, 1, 99, 2, 3, 4}
    l.erase(it);          // 删除 2 -> {0, 1, 99, 3, 4}

    l.pop_front();
    l.pop_back();
    for (int x : l) std::cout << x << ' ';
    std::cout << '\n';
    return 0;
}
```
:::

---

## 四、`list` 专属的高阶成员函数（面试 / 笔试极其重要）

> 因为 `list` 内存不连续，无法使用 `<algorithm>` 中需要“随机访问迭代器”的泛型算法（如 `std::sort`）。STL 为 `list` 内置了专属高阶成员函数，直接操作底层指针，效率极高。

| 函数名 | 作用 | 重点提示与示例 |
| :--- | :--- | :--- |
| `sort()` | 对链表进行排序 | **必考点**：不能用泛型 `std::sort(l.begin(), l.end())`（编译报错），只能用 `l.sort()`。默认升序，可传比较器 `l.sort(std::greater<int>())`。 |
| `reverse()` | 反转链表 | 直接调用 `l.reverse()`，通过反转内部指针方向实现，效率远高于泛型的 `std::reverse`。 |
| `merge(list2)` | 合并两个已经排好序的链表 | `l1.merge(l2);` 合并后 `l1` 包含所有元素且有序，**`l2` 变为空链表**（节点直接转移，无数据拷贝）。 |
| `splice(pos, list2)` | 接合（剪切并粘贴） | `l1.splice(l1.begin(), l2);` 把 `l2` 的全部/部分节点直接剪切到 `l1` 的 `pos` 位置前。全程只有指针断开与连接，**0 内存拷贝**，极其高效。 |
| `remove(val)` | 移除所有值为 `val` 的元素 | 会改变 `size`。直接写 `l.remove(3);` 就能删掉所有 `3`（无需像 `vector` 那样用 `erase(remove(...))`）。 |
| `remove_if(pred)` | 根据条件（谓词）移除元素 | 例：`l.remove_if([](int n){ return n % 2 == 0; });` 删除所有偶数。 |
| `unique()` | 移除相邻的重复元素 | 会改变 `size`。与泛型 `std::unique` 不同，`list::unique()` 会**直接删除**多余节点，不需要配合 `erase`。执行前通常需先 `sort()`。 |

::: details 点击查看代码示例：list 专属高阶成员函数
```cpp
#include <iostream>
#include <list>
#include <functional>

int main() {
    std::list<int> l1 = {3, 1, 4, 1, 5, 9};
    l1.sort();                      // {1, 1, 3, 4, 5, 9}
    l1.unique();                    // {1, 3, 4, 5, 9}（直接删除重复节点）
    l1.remove(3);                   // {1, 4, 5, 9}
    l1.remove_if([](int n){ return n % 2 == 0; }); // 删除偶数 -> {1, 5, 9}

    std::list<int> l2 = {2, 6, 8};
    l1.merge(l2);                   // l1={1, 2, 5, 6, 8, 9}, l2 变为空

    std::list<int> l3 = {100, 200};
    l1.splice(l1.begin(), l3);      // 0 拷贝剪切 l3 到 l1 头部，l3 变为空
    l1.reverse();                   // 反转链表

    for (int x : l1) std::cout << x << ' ';
    std::cout << '\n';
    return 0;
}
```
:::

---

## 五、迭代器失效规则（`list` 的绝对优势）

::: tip 对比 `vector` / `string` 的悬空指针痛点
- **`vector` / `string`**：插入可能触发底层内存重新分配（扩容搬家），导致所有旧指针、引用和迭代器瞬间全部失效；即便不扩容，中间插入/删除也会导致该位置之后的所有迭代器失效。
- **`list` 的绝对优势**：
  1. 在 `list` 中进行 `insert`、`splice` 等**插入操作，绝对不会导致任何现有的迭代器、指针或引用失效**。
  2. 即使是进行 `erase` **删除操作，也仅仅只会导致指向被删除那个具体节点的迭代器失效**，其他所有节点的迭代器依然绝对安全。
:::

---

## 六、常用泛型算法与 `list` 避坑指南

> 需 `#include <algorithm>` 或 `<numeric>`。

| 操作 | 泛型写法 | 在 `list` 中的适用性 / 注意事项 |
| :--- | :--- | :--- |
| **排序** | `std::sort(l.begin(), l.end());` | **绝对不能用**，`list` 编译都无法通过，必须用 `l.sort()`。 |
| **反转** | `std::reverse(l.begin(), l.end());` | 能通过编译，但**强烈不推荐**，请用 `l.reverse()`。 |
| **去重** | `l.erase(std::unique(l.begin(), l.end()), l.end());` | 能通过编译，但**往往达不到预期效率**，请直接用 `l.unique()`。 |
| **复制** | `std::copy(v1.begin(), v1.end(), v2.begin());` | `copy` 不会自动扩容目标容器，需确保目标有足够空间。 |
| **填充** | `std::fill(l.begin(), l.end(), 1);` | 将区间内所有元素赋值为 `1`。 |
| **查找 / 统计** | `std::find` / `find_if` / `count` / `count_if` | 正常可用（线性遍历）。 |
| **移除** | `std::remove(l.begin(), l.end(), val);` | 需配合 `erase`，但 `list` 推荐直接用成员函数 `l.remove(val)`。 |
| **累加** | `std::accumulate(l.begin(), l.end(), 0);` | 需 `#include <numeric>`，第三个参数 `0` 决定累加类型（防溢出可写 `0LL`）。 |
| **变换 / 遍历 / 替换** | `std::transform` / `std::for_each` / `std::replace` | 正常可用。 |
| **交换 / 极值** | `std::swap` / `std::max_element` / `std::min_element` | 交换优先用 `l1.swap(l2)`（仅交换内部指针）。 |

::: warning 原表重点避坑总结
1. `std::sort`：**绝对不能用**（编译报错）。
2. `std::reverse`：能通过编译，但**强烈不推荐**（改用 `l.reverse()`）。
3. `std::unique`：能通过编译，但**往往达不到预期**（改用 `l.unique()`）。
:::