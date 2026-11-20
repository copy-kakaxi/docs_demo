# C++ STL 容器笔记：`std::vector`

## 简介

`std::vector` 是 C++ 标准模板库（STL）中最常用的序列式容器，本质上是一个**动态扩容的连续数组**。

::: tip 核心特性速览
- **底层结构**：连续内存空间（支持指针偏移，具备极佳的 CPU 缓存局部性）。
- **随机访问**：支持下标 `[]` 与 `at()`，时间复杂度为 $O(1)$。
- **尾部增删**：尾部插入 `push_back` / `emplace_back`（均摊 $O(1)$）与尾部删除 `pop_back`（$O(1)$）效率极高。
- **中间/头部增删**：插入 `insert` 与删除 `erase` 需要搬移后续元素，时间复杂度为 $O(n)$。
- **动态扩容**：当容量（`capacity`）不足时，会申请一块更大的新内存（通常为原容量的 $1.5$ 倍或 $2$ 倍），将旧元素移动/拷贝过去并释放旧内存。
:::

---

## 一、 构造函数（Initialization）

`std::vector` 提供了多种重载的构造方式，以适应不同的初始化场景：

| 构造方式 | 函数原型 / 语法 | 说明 |
| :--- | :--- | :--- |
| **默认构造** | `vector<T> v;` | 创建一个空的 `vector`，`size` 和 `capacity` 均为 $0$ |
| **指定大小（默认初始化）** | `vector<T> v(n);` | 创建包含 $n$ 个默认初始化元素的 `vector`（内置类型通常初始化为 $0$） |
| **指定大小与初值** | `vector<T> v(n, val);` | 创建包含 $n$ 个值为 `val` 的元素的 `vector` |
| **区间拷贝构造** | `vector<T> v(beg, end);` | 将 `[beg, end)` 迭代器区间内的元素拷贝构造到新容器中（支持原生数组指针） |
| **拷贝构造** | `vector<T> v2(v1);` | 深拷贝另一个同类型 `vector` 的所有元素 |
| **移动构造 (C++11)** | `vector<T> v2(std::move(v1));` | 接管 `v1` 的底层内存指针（$O(1)$ 开销），`v1` 变为空 |
| **初始化列表 (C++11)** | `vector<T> v = {a, b, c};` | 使用花括号初始化列表直接构造元素 |

### 示例代码

```cpp
#include <iostream>
#include <vector>

int main() {
    // 1. 默认构造
    std::vector<int> v1;

    // 2. 指定大小与初值
    std::vector<int> v2(5);        // {0, 0, 0, 0, 0}
    std::vector<int> v3(5, 100);   // {100, 100, 100, 100, 100}

    // 3. 初始化列表
    std::vector<int> v4 = {1, 2, 3, 4, 5};

    // 4. 区间构造（支持其他容器迭代器或原生数组指针）
    int arr[] = {10, 20, 30, 40};
    std::vector<int> v5(arr, arr + 4);               // {10, 20, 30, 40}
    std::vector<int> v6(v4.begin() + 1, v4.end());   // {2, 3, 4, 5}

    // 5. 拷贝构造与移动构造
    std::vector<int> v7(v4);                         // 深拷贝
    std::vector<int> v8(std::move(v7));              // 移动构造，v7 变为空

    return 0;
}
```

---

## 二、 赋值操作（Assignment）

除了在构造时初始化，还可以通过赋值操作符或 `assign` 成员函数整体替换容器内容：

| 操作方式 | 语法 | 说明 |
| :--- | :--- | :--- |
| **拷贝赋值** | `v2 = v1;` | 将 `v1` 的所有元素深拷贝赋值给 `v2` |
| **初始化列表赋值** | `v = {1, 2, 3};` | 用列表中的元素覆盖当前容器 |
| **区间赋值** | `v.assign(beg, end);` | 将 `[beg, end)` 区间内的元素拷贝并覆盖当前容器 |
| **数量+初值赋值** | `v.assign(n, val);` | 用 $n$ 个值为 `val` 的元素覆盖当前容器 |

### 示例代码

```cpp
#include <vector>

int main() {
    std::vector<int> v1 = {1, 2, 3};
    std::vector<int> v2;

    v2 = v1;                     // 拷贝赋值：{1, 2, 3}
    v2 = {7, 8, 9, 10};          // 列表赋值：{7, 8, 9, 10}
    v2.assign(4, 66);            // 数量赋值：{66, 66, 66, 66}
    v2.assign(v1.begin(), v1.end()); // 区间赋值：{1, 2, 3}

    return 0;
}
```

---

## 三、 容量与大小管理（Capacity & Size）

理解 `size`（当前元素个数）和 `capacity`（当前已分配内存可容纳的最大元素个数）的区别是掌握 `std::vector` 的关键。

| 函数名 | 作用说明 | 复杂度 |
| :--- | :--- | :--- |
| `size()` | 返回容器中**当前实际存储**的元素个数 | $O(1)$ |
| `capacity()` | 返回容器**当前不重新分配内存**的前提下最多能容纳的元素个数（永远满足 $\text{capacity} \ge \text{size}$） | $O(1)$ |
| `empty()` | 判断容器是否为空（即 `size() == 0`），**判空优先用 `empty()`** | $O(1)$ |
| `resize(n)` / `resize(n, val)` | 改变容器的 **`size`**（若 $n > \text{size}$ 则填充默认元素或 `val`；若 $n < \text{size}$ 则截断销毁多余元素，但**通常不缩小 `capacity`**） | $O(n)$ |
| `reserve(n)` | 预留空间，改变容器的 **`capacity`**（若 $n > \text{capacity}$ 则提前分配内存，**不改变 `size`**，不构造元素；若 $n \le \text{capacity}$ 则无效果） | $O(n)$ |
| `shrink_to_fit()` | 请求释放多余的预留内存，使 `capacity()` 缩减至与 `size()` 匹配（非强制性绑定，但主流编译器均支持） | $O(n)$ |

::: warning 核心避坑：`reserve()` vs `resize()` 的本质区别
这是面试和日常开发中最容易混淆的一对函数：
1. **`reserve(n)` 只管“地皮”（`capacity`），不管“房子”（`size`）**：
   调用 `v.reserve(10)` 后，`v.size()` 仍然是 `0`！此时绝对不能直接通过 `v[0] = 1` 访问元素（属于越界未定义行为），必须配合 `push_back` 或 `emplace_back` 使用。它的核心价值是**已知数据规模时提前预留空间，避免反复扩容带来的内存重分配与元素拷贝开销**。
2. **`resize(n)` 既管“地皮”又建“房子”（`size`）**：
   调用 `v.resize(10)` 后，`v.size()` 真正变成了 `10`，容器里已经构造好了 $10$ 个元素，此时可以直接使用 `v[0] = 1` 进行读写。
:::

### 示例代码

```cpp
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v;

    // 1. 预留空间：只增加 capacity，不增加 size
    v.reserve(100);
    std::cout << "after reserve(100): size=" << v.size() 
              << ", capacity=" << v.capacity() << '\n'; // size=0, capacity=100

    // 2. 调整大小：同时改变 size（构造默认元素）
    v.resize(5, 42);
    std::cout << "after resize(5, 42): size=" << v.size() 
              << ", capacity=" << v.capacity() << '\n'; // size=5, capacity=100

    // 3. 缩减 size：销毁多余元素，但 capacity 保持不变
    v.resize(2);
    std::cout << "after resize(2): size=" << v.size() 
              << ", capacity=" << v.capacity() << '\n'; // size=2, capacity=100

    // 4. 释放多余容量（收缩内存）
    v.shrink_to_fit();
    std::cout << "after shrink_to_fit(): size=" << v.size() 
              << ", capacity=" << v.capacity() << '\n'; // size=2, capacity=2

    return 0;
}
```

---

## 四、 元素访问（Element Access）

| 函数 / 操作符 | 作用说明 | 边界检查 | 复杂度 |
| :--- | :--- | :--- | :--- |
| `v[idx]` | 返回索引 `idx` 处元素的引用 | **不检查**（越界触发未定义行为 UB，速度最快） | $O(1)$ |
| `v.at(idx)` | 返回索引 `idx` 处元素的引用 | **检查**（越界抛出 `std::out_of_range` 异常） | $O(1)$ |
| `v.front()` | 返回**第一个**元素的引用（调用前必须确保 `!v.empty()`） | 不检查 | $O(1)$ |
| `v.back()` | 返回**最后一个**元素的引用（调用前必须确保 `!v.empty()`） | 不检查 | $O(1)$ |
| `v.data()` | 返回指向底层连续内存首地址的原生指针 `T*`（常用于与 C 语言 API 交互） | 不检查 | $O(1)$ |

### 示例代码

```cpp
#include <iostream>
#include <vector>
#include <stdexcept>

int main() {
    std::vector<int> v = {10, 20, 30, 40};

    std::cout << "front: " << v.front() << '\n'; // 10
    std::cout << "back:  " << v.back()  << '\n'; // 40
    std::cout << "v[1]:  " << v[1]      << '\n'; // 20

    try {
        std::cout << v.at(10) << '\n'; // 越界，抛出异常
    } catch (const std::out_of_range& e) {
        std::cout << "捕获越界异常: " << e.what() << '\n';
    }

    // 获取底层原生指针
    int* raw_ptr = v.data();
    std::cout << "raw_ptr[2]: " << raw_ptr[2] << '\n'; // 30

    return 0;
}
```

---

## 五、 增删改操作（Modifiers）

| 函数名 | 作用说明 | 复杂度 |
| :--- | :--- | :--- |
| `push_back(val)` | 在容器**尾部**追加一个元素（先构造临时对象，再拷贝/移动到容器尾部） | 均摊 $O(1)$ |
| `emplace_back(args...)` | 在容器**尾部原地构造**元素（直接转发构造函数参数，避免临时对象拷贝/移动，C++11 推荐） | 均摊 $O(1)$ |
| `pop_back()` | 删除容器**尾部**最后一个元素（不返回被删元素；调用前必须确保 `!v.empty()`） | $O(1)$ |
| `insert(pos, val)` | 在迭代器 `pos` 指向位置**之前**插入元素，返回指向新插入元素的迭代器（另有插入 $n$ 个元素、插入区间等重载） | $O(n)$ |
| `emplace(pos, args...)` | 在迭代器 `pos` 指向位置**之前原地构造**元素，返回指向新元素的迭代器 | $O(n)$ |
| `erase(pos)` | 删除迭代器 `pos` 指向的单个元素，**返回指向被删元素下一个位置的迭代器** | $O(n)$ |
| `erase(beg, end)` | 删除 `[beg, end)` 区间内的所有元素，返回指向 `end` 原位置元素的迭代器 | $O(n)$ |
| `clear()` | 清空所有元素（`size` 变为 $0$，但 **`capacity` 保持不变**，不释放底层内存） | $O(n)$ |
| `swap(other)` | 交换两个 `vector` 的内容（仅交换内部指针，不拷贝元素，也可用于释放内存技巧） | $O(1)$ |

### 示例代码

```cpp
#include <iostream>
#include <vector>
#include <string>

int main() {
    std::vector<std::string> v;

    // 1. 尾部插入
    v.push_back("hello");
    v.emplace_back("world"); // 原地构造，推荐用法

    // 2. 指定位置插入（insert 需要传入迭代器）
    v.insert(v.begin() + 1, "C++"); // {"hello", "C++", "world"}
    v.insert(v.end(), 2, "!");       // {"hello", "C++", "world", "!", "!"}

    // 3. 删除操作
    v.pop_back();                    // 删除最后一个 "!"
    v.erase(v.begin());              // 删除第一个 "hello" -> {"C++", "world", "!"}
    v.erase(v.begin() + 1, v.end()); // 删除区间 -> {"C++"}

    // 4. 清空容器（注意 capacity 不会变）
    v.clear();

    // 5. 经典内存释放技巧（C++11 前常用，现代 C++ 可直接用 shrink_to_fit()）
    std::vector<int> big_vec(10000, 1);
    std::vector<int>().swap(big_vec); // 与临时空对象交换，big_vec 的 capacity 彻底归 0

    return 0;
}
```

---

## 六、 迭代器与遍历方式（Iterators）

`std::vector` 的迭代器属于**随机访问迭代器（Random Access Iterator）**，支持 `it + n`、`it - n`、`it1 < it2` 等算术与比较运算。

| 迭代器接口 | 指向位置与属性 |
| :--- | :--- |
| `begin()` / `end()` | 指向首元素 / 尾后位置（哨兵位置，不可解引用）的普通迭代器 |
| `cbegin()` / `cend()` | 只读常量迭代器（`const_iterator`），不可通过它修改元素 |
| `rbegin()` / `rend()` | 反向迭代器，分别指向**最后一个元素**和**首元素前一个位置**，`++rit` 向前移动 |

### 四种常见遍历写法

```cpp
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v = {10, 20, 30, 40};

    // 1. 范围 for 循环（最推荐，简洁安全；若需修改元素用 auto&，只读大对象用 const auto&）
    for (const auto& x : v) {
        std::cout << x << ' ';
    }
    std::cout << '\n';

    // 2. 下标遍历（需要用到索引位置时使用）
    for (size_t i = 0; i < v.size(); ++i) {
        std::cout << v[i] << ' ';
    }
    std::cout << '\n';

    // 3. 正向迭代器遍历
    for (auto it = v.begin(); it != v.end(); ++it) {
        std::cout << *it << ' ';
    }
    std::cout << '\n';

    // 4. 反向迭代器遍历（逆序输出：40 30 20 10）
    for (auto rit = v.rbegin(); rit != v.rend(); ++rit) {
        std::cout << *rit << ' ';
    }
    std::cout << '\n';

    return 0;
}
```

---

## 七、 常见易错点与面试高频陷阱

### 1. 迭代器失效（Iterator Invalidation）—— 最致命的 Bug 来源

::: warning 什么情况下 `vector` 的迭代器（及指针、引用）会失效？
1. **发生扩容时（如 `push_back`、`emplace_back`、`insert`、`resize` 导致 `size > capacity`）**：
   底层会重新申请一块新内存并释放旧内存，**所有指向旧内存的迭代器、指针、引用全部失效**！
2. **未发生扩容，但在中间 `insert` 时**：
   插入点 `pos` **及其之后**的所有迭代器、指针、引用全部失效（因为元素整体向后挪动了）。
3. **执行 `erase` 删除元素时**：
   被删除位置 `pos` **及其之后**的所有迭代器、指针、引用全部失效（因为后续元素整体向前挪动了）。
:::

#### 正确写法：循环中安全删除元素（`erase` 返回值接力）

```cpp
std::vector<int> v = {1, 2, 3, 4, 5, 6};

// ❌ 错误写法：erase 后 it 已经失效，再执行 ++it 会引发未定义行为（崩溃或漏删）
// for (auto it = v.begin(); it != v.end(); ++it) {
//     if (*it % 2 == 0) v.erase(it);
// }

// ✅ 正确写法：利用 erase() 返回“下一个有效迭代器”的特性
for (auto it = v.begin(); it != v.end(); ) {
    if (*it % 2 == 0) {
        it = v.erase(it); // 接住返回的新迭代器，不要再 ++it
    } else {
        ++it;
    }
}
// 最终 v = {1, 3, 5}
```
*(注：如果是在大量元素中按条件删除，工业界更推荐使用 **Erase-Remove 惯用法**：`v.erase(std::remove_if(v.begin(), v.end(), pred), v.end());`，时间复杂度可从 $O(n^2)$ 降至 $O(n)$。)*

---

### 2. `std::vector<bool>` 的特殊陷阱

`std::vector<bool>` 是标准库对 `std::vector<T>` 做的一个**全特化版本**：
- **底层实现**：为了节省内存，它并不是按每个 `bool` 占 $1$ 字节存储，而是**按位（bit）压缩存储**（$1$ 个字节存 $8$ 个 `bool`）。
- **带来的坑**：因为 C++ 无法直接取单个 bit 的内存地址，所以 `v[0]` 返回的不是 `bool&` 引用，而是一个临时的代理对象（`std::vector<bool>::reference`）。
- **后果**：不能写 `bool* p = &v[0];` 或 `auto& x = v[0];`（会编译报错或产生悬空引用）。如果不需要极致省内存，实际工程中常使用 `std::vector<uint8_t>` 或 `std::deque<bool>` 替代。