# C++ STL 容器笔记：`std::deque`

## 简介

`std::deque`（双端队列）表面上看起来像 `vector`（支持 `[]` 随机访问），但骨子里又部分具备 `list` 的特性（支持头部高效插入）。

::: tip 底层内存结构与核心限制
- **分段连续存储**：`deque` 并不是一整块连续内存，而是由一段一段固定大小的**小连续内存块（缓冲区 / Chunk）**组成，外加一个**中控器（Map，本质是指针数组）**来管理这些小内存块。
- **没有 `capacity()` 和 `reserve()`**：因为是分块分配内存，不需要像 `vector` 那样为了防止整体搬家而预留空间，所以 `deque` **绝对没有 `capacity()` 和 `reserve()` 函数**。
:::

---

## 一、构造函数

| 构造方式 | 函数原型 / 形式 | 说明 |
| :--- | :--- | :--- |
| **默认构造** | `explicit deque(const Allocator& alloc);` / `deque<T> d;` | 创建空 `deque`。 |
| **指定大小构造** | `deque(size_type count, const T& value);` | 创建包含 `count` 个 `value` 的 `deque`。 |
| **范围构造** | `deque(InputIt first, InputIt last);` | 从迭代器区间 `[first, last)` 构造。 |
| **拷贝构造** | `deque(const deque& other);` | 拷贝另一个 `deque`。 |
| **移动构造（C++11）** | `deque(deque&& other);` | 转移内部中控器与缓冲区所有权。 |
| **初始化列表（C++11）** | `deque(std::initializer_list<T> init);` | 通过花括号初始化列表构造。 |

::: details 点击查看代码示例：构造函数
```cpp
#include <iostream>
#include <deque>
#include <utility>

int main() {
    std::deque<int> d1;                      // 默认构造
    std::deque<int> d2(5, 10);               // 5 个 10
    std::deque<int> d3 = {1, 2, 3, 4, 5};    // 初始化列表
    std::deque<int> d4(d3.begin() + 1, d3.end()); // 范围构造：{2, 3, 4, 5}
    std::deque<int> d5(d3);                  // 拷贝构造
    std::deque<int> d6(std::move(d5));       // 移动构造

    for (int x : d6) std::cout << x << ' ';
    std::cout << '\n';
    return 0;
}
```
:::

---

## 二、容量与属性、元素访问

| 函数名 | 作用 | 重点提示 |
| :--- | :--- | :--- |
| `size()` | 返回当前元素的个数 | $O(1)$ 复杂度。 |
| `empty()` | 判断容器是否为空 | 空则返回 `true`。 |
| `resize(n, val)` | 改变容器的实际大小 | 变大则在尾部分配新块填充 `val`，变小则销毁尾部多余块。 |
| `shrink_to_fit()` | 释放未使用的内存块（C++11） | 缩减中控器和释放空闲缓冲区。 |
| `operator[]` / `at(pos)` | 随机访问指定索引的元素 | 支持 `d[5]`！复杂度为 $O(1)$（常数比 `vector` 稍大，因为底层需经中控器做一次数学计算定位数据块）。 |
| `front()` / `back()` | 返回首元素 / 尾元素的引用 | 空容器上调用会导致未定义行为。 |
| `data()` | **不支持！** | **必考点**：因为 `deque` 底层内存是不连续的，无法像 `string` 或 `vector` 那样交出底层 `T*` 裸指针，不能直接传给 C 语言的 `memcpy`。 |

::: details 点击查看代码示例：容量与元素访问
```cpp
#include <iostream>
#include <deque>

int main() {
    std::deque<int> d = {10, 20, 30, 40};
    std::cout << "d[2]=" << d[2] << ", at(3)=" << d.at(3)
              << ", front=" << d.front() << ", back=" << d.back() << '\n';

    d.resize(6, 99);   // {10, 20, 30, 40, 99, 99}
    d.resize(2);       // {10, 20}
    d.shrink_to_fit(); // 请求释放多余缓冲区
    return 0;
}
```
:::

---

## 三、修改与增删（核心威力区）

| 函数名 | 作用 | 重点提示 |
| :--- | :--- | :--- |
| `push_back(val)` / `pop_back()` | 在尾部添加 / 删除元素 | $O(1)$ 复杂度。空间不够直接分配新数据块，不会发生全局数据搬家。 |
| `push_front(val)` / `pop_front()` | 在头部添加 / 删除元素 | $O(1)$ 复杂度。**这是相比 `vector` 的最大优势**（`vector` 在头部插入是 $O(n)$）。 |
| `emplace_front(...)` / `emplace_back(...)` | 首尾原地构造元素 | 减少拷贝 / 移动开销（C++11）。 |
| `insert(pos, val)` | 在指定位置插入元素 | **效率低！**需要移动 `pos` 前面或后面的元素（`deque` 内部会智能判断哪边元素少就移动哪边），复杂度 $O(n)$。 |
| `erase(pos)` / `erase(first, last)` | 删除指定位置或区间的元素 | **效率低！**同样需要大批量移动元素，复杂度 $O(n)$。 |
| `clear()` | 清空所有元素 | 释放所有数据块，保留一个空的中控器。 |
| `swap(d2)` | 交换两个 `deque` 的内容 | 极其高效，仅交换内部指针/中控器，不需要拷贝元素。 |
| `assign(...)` | 覆盖容器的现有内容 | 支持 `(n, val)`、`(first, last)`、初始化列表。 |

::: details 点击查看代码示例：修改与增删
```cpp
#include <iostream>
#include <deque>

int main() {
    std::deque<int> d = {20, 30};
    d.push_front(10);      // {10, 20, 30}
    d.push_back(40);       // {10, 20, 30, 40}
    d.emplace_front(5);    // {5, 10, 20, 30, 40}
    d.emplace_back(50);    // {5, 10, 20, 30, 40, 50}

    d.insert(d.begin() + 2, 99); // {5, 10, 99, 20, 30, 40, 50}
    d.erase(d.begin() + 2);      // {5, 10, 20, 30, 40, 50}

    d.pop_front();
    d.pop_back();
    for (int x : d) std::cout << x << ' ';
    std::cout << '\n';
    return 0;
}
```
:::

---

## 四、兼容的泛型算法（`<algorithm>` / `<numeric>`）

> 因为 `deque` 提供了**随机访问迭代器**（尽管底层实现较复杂），所以 **`vector` 能用的泛型算法，`deque` 全都能用**。

| 功能分类 | 写法 / 示例 | 重点提示 |
| :--- | :--- | :--- |
| **排序（升序/降序）** | `std::sort(d.begin(), d.end());` | 支持随机访问迭代器，可直接排序。 |
| **反转** | `std::reverse(d.begin(), d.end());` | 原地反转元素顺序。 |
| **复制容器内容** | `std::copy(d1.begin(), d1.end(), d2.begin());` | **`copy` 不会自动扩容目标容器！**空间不足会越界写入。 |
| **填充** | `std::fill(d.begin(), d.end(), 1);` | 将区间内所有元素赋值为 `1`，替代 C 语言的 `memset`。 |
| **查找元素** | `auto it = std::find(d.begin(), d.end(), val);` | 返回迭代器；条件查找用 `std::find_if()`。 |
| **统计数量** | `int cnt = std::count(d.begin(), d.end(), val);` | 条件统计用 `std::count_if()`。 |
| **去重（需先排序）** | `d.erase(std::unique(d.begin(), d.end()), d.end());` | 必考点：`unique` 只能去除相邻重复元素，必须先 `sort` 再配合 `erase`。 |
| **移除** | `auto it = std::remove(d.begin(), d.end(), val);` | 返回重组后的新逻辑末尾迭代器，需配合 `d.erase(it, d.end())` 使用。 |
| **累加计算** | `int sum = std::accumulate(d.begin(), d.end(), 0);` | 需 `#include <numeric>`；第三个参数 `0` 决定累加类型（防溢出可写 `0LL`）。 |
| **变换** | `std::transform(d.begin(), d.end(), d.begin(), func);` | 如字符转大小写可传 `::toupper` 或 `::tolower`。 |
| **遍历处理** | `std::for_each(d.begin(), d.end(), [](auto& x){ x += 1; });` | 对每个元素执行自定义操作。 |
| **替换** | `std::replace(d.begin(), d.end(), old_val, new_val);` | 替换区间内指定值。 |
| **交换** | `std::swap(d1, d2);` | 仅交换内部指针，不拷贝大量元素。 |
| **最大值 / 最小值** | `std::max_element` / `std::min_element` | 返回最值所在的迭代器。 |

::: details 点击查看代码示例：兼容的泛型算法
```cpp
#include <iostream>
#include <deque>
#include <algorithm>
#include <numeric>

int main() {
    std::deque<int> d = {4, 1, 3, 1, 2, 5};

    // 1. 排序 + 去重
    std::sort(d.begin(), d.end());
    d.erase(std::unique(d.begin(), d.end()), d.end()); // {1, 2, 3, 4, 5}

    // 2. 累加与反转
    long long sum = std::accumulate(d.begin(), d.end(), 0LL);
    std::reverse(d.begin(), d.end()); // {5, 4, 3, 2, 1}

    // 3. 极值与遍历
    auto max_it = std::max_element(d.begin(), d.end());
    std::cout << "sum=" << sum << ", max=" << *max_it << '\n';
    return 0;
}
```
:::

---

## 五、迭代器失效规则（高频面试考点）

::: warning `deque` 的三条核心失效规则
1. **在中间插入 / 删除（`insert`、`erase`）—— 灾难性失效**：
   `deque` 中的**所有迭代器、指针和引用都可能失效**（内部需要移动元素以腾出空间或填补空缺）。
2. **在首尾插入（`push_front`、`push_back`）—— 反直觉点**：
   - **所有迭代器可能失效**（因为内部中控器 `map` 满时可能会重新分配）。
   - **指向已有元素的指针和引用仍然有效**（存放元素的内存块本身没有被移动或销毁）。
3. **在首尾删除（`pop_front`、`pop_back`）**：
   **仅被删除元素**的迭代器和引用失效，其他元素不受影响。
:::