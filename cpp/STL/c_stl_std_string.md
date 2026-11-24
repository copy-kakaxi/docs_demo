# C++ STL 容器笔记：`std::string`

## 简介

`std::string` 是 C++ 标准库中用于处理字符串的类模板特化（`std::basic_string<char>`），底层维护一段连续的字符内存空间，支持动态扩容，并提供了丰富的查找、截取、替换及与 C 风格字符串兼容的接口。

---

## 一、构造函数

| 构造方式 | 形式 / 示例 | 说明与备注 |
| :--- | :--- | :--- |
| **默认构造** | `string s;` | 创建一个空字符串。 |
| **字符串常量构造** | `string s("Hello");` | 使用 C 风格字符串字面量初始化。 |
| **拷贝构造** | `string s2(s1);` | 深拷贝另一个 `string` 对象。 |
| **部分构造** | `string s(cp, n);` | 取字符数组 `cp` 的前 `n` 个字符。 |
| **重复构造** | `string s(n, 'c');` | 生成包含 `n` 个字符 `'c'` 的字符串。 |
| **区间（迭代器）构造** | `string s(begin, end);` | 使用迭代器区间 `[begin, end)` 初始化。 |
| **子串构造** | `string s5(s2, 1, 3);` | 从 `s2` 的索引 `1` 开始取 `3` 个字符（如 `"Hello"` -> `"ell"`）。 |
| **移动构造（C++11）** | `string s(std::move(s1));` | 高效转移所有权，避免深拷贝。 |

::: details 点击查看代码示例：构造函数
```cpp
#include <iostream>
#include <string>
#include <utility>

int main() {
    std::string s1;                          // 默认构造：""
    std::string s2("Hello");                 // 字符串常量构造："Hello"
    std::string s3(s2);                      // 拷贝构造："Hello"

    const char* cp = "Hello World";
    std::string s4(cp, 5);                   // 部分构造："Hello"
    std::string s5(4, 'c');                  // 重复构造："cccc"
    std::string s6(s2.begin(), s2.end());    // 区间构造："Hello"
    std::string s7(s2, 1, 3);                // 子串构造："ell"
    std::string s8(std::move(s3));           // 移动构造，s8="Hello"，s3 变为有效但未指定状态

    std::cout << s4 << " | " << s5 << " | " << s7 << " | " << s8 << '\n';
    return 0;
}
```
:::

---

## 二、常用成员函数（访问、容量、增删改查）

| 函数名 | 描述 | 重点提示与多版本说明 |
| :--- | :--- | :--- |
| `at(n)` | 返回第 `n` 个字符 | 带越界检查（越界抛出 `std::out_of_range` 异常）。 |
| `operator[]` | 返回第 `n` 个字符 | 不检查越界，速度快。 |
| `front()` / `back()` | 返回首字符 / 末字符 | 返回 `char&` 类型（空串调用为未定义行为）。 |
| `size()` / `length()` | 返回字符串长度 | 两者等价，返回当前字符个数。 |
| `empty()` | 判断是否为空 | 空则返回 `true`。 |
| `capacity()` | 返回当前分配的存储空间大小 | 扩容前最多可容纳的字符数。 |
| `reserve(n)` | 预留存储空间 | 提前分配空间，防止多次重分配。 |
| `push_back('c')` / `pop_back()` | 在末尾添加 / 删除字符 | `push_back` 接收 `char` 类型参数。 |
| `append("str")` / `append(str)` | 在字符串末尾追加内容 | 参数可为 `const char*` 或 `string`（也可直接用 `s += "str"`）。<br>多版本：`append(str)`、`append(str, pos, count=npos)`、`append(s)`、`append(s, count)`。 |
| `insert(pos, "str")` | 在指定位置插入内容 | 支持 `pos + const char*` / `string` / `n` 个 `char` / 迭代器。<br>**插入位置之后的内容不会被覆盖，只是后移。** |
| `erase(pos, len)` | 从 `pos` 开始删除 `len` 个字符 | 多版本：`erase(size_t pos = 0, size_t count = npos)`、`erase(iterator pos)`、`erase(iterator first, iterator last)`。 |
| `replace(pos, len, "str")` | 替换指定范围的内容 | 例：`s1.replace(6, 5, s2);` 从位置 6 开始替换 5 个字符 -> `"Hello C++"`。 |
| `clear()` | 清空字符串 | `size` 归 0，`capacity` 通常不变。 |
| `swap(s2)` | 交换两个字符串的内容 | 仅交换内部指针，开销极低。 |
| `find(str, pos)` | 从 `pos` 开始查找子串 | 返回首次出现的索引；找不到返回 `string::npos`。默认 `pos = 0`。 |
| `rfind(str, pos)` | 反向查找 | 有 `pos` 参数时，在下标 `0 ~ pos` 的范围内反向查找对应的下标。 |
| `substr(pos, len)` | 截取并返回一个新的 `string` 对象 | 从 `pos` 开始截取 `len` 个字符；**被截取的原字符串不发生任何变化**。 |
| `compare(s2)` | 比较字符串大小 | 返回 `0`（相等）、`>0`（大于）或 `<0`（小于）。 |
| `c_str()` | 返回以 `\0` 结尾的 C 风格字符数组指针 | 返回 `const char*`，用于兼容旧 C 接口。 |

::: details 点击查看代码示例：常用成员函数
```cpp
#include <iostream>
#include <string>

int main() {
    std::string s = "Hello";
    s.reserve(32);

    // 访问与追加
    s.push_back(' ');
    s.append("World");                // "Hello World"
    s.insert(5, ",");                 // "Hello, World"
    s.replace(7, 5, "C++");           // "Hello, C++"

    // 查找与截取
    size_t pos = s.find("C++");
    if (pos != std::string::npos) {
        std::string sub = s.substr(pos, 3); // "C++"
        std::cout << "Found: " << sub << " at " << pos << '\n';
    }

    // 删除与比较
    s.erase(5, 1);                    // "Hello C++"
    std::cout << "compare: " << s.compare("Hello C++") << '\n'; // 0
    std::cout << "front: " << s.front() << ", back: " << s.back() << '\n';

    return 0;
}
```
:::

---

## 三、常用泛型函数（15 个）

> 需包含 `#include <algorithm>`（`accumulate` 需包含 `#include <numeric>`）。

| 功能分类 | 写法 / 示例 | 重点提示 |
| :--- | :--- | :--- |
| **排序** | `std::sort(s.begin(), s.end());` | 默认按 ASCII 码升序排列。 |
| **反转** | `std::reverse(s.begin(), s.end());` | 原地反转字符串（如 `"cbade"` -> `"edabc"`）。 |
| **复制容器内容** | `std::copy(v1.begin(), v1.end(), dest.begin());` | **`copy` 不会自动扩容目标容器！**它从 `dest.begin()` 开始覆盖写入，目标空间不足会越界写入。 |
| **填充** | `std::fill(s.begin(), s.end(), '*');` | 将区间内所有字符填充为 `'*'`。 |
| **查找字符** | `auto it = std::find(s.begin(), s.end(), 'a');` | 返回迭代器；条件查找可用 `std::find_if()`。 |
| **统计字符数量** | `int cnt = std::count(s.begin(), s.end(), 'a');` | 条件统计可用 `std::count_if()`。 |
| **去除重复（需先排序）** | `s.erase(std::unique(s.begin(), s.end()), s.end());` | `unique` 只去除相邻重复元素，必须先 `sort` 再配合 `erase`。 |
| **移除** | `auto it = std::remove(s.begin(), s.end(), 'l');` | 返回“有效元素前移”重组后的**新逻辑末尾**，需配合 `s.erase(it, s.end())` 真正删除。 |
| **计算（累加）** | `std::accumulate(s.begin(), s.end(), 0);` | 对 `string` 使用会把 `char` 的 ASCII 码相加，可能不是想要的结果。 |
| **大小写转换** | `std::transform(s.begin(), s.end(), s.begin(), ::toupper);` | 最后一个参数写 `::toupper` 或 `::tolower`。 |
| **遍历处理** | `std::for_each(s.begin(), s.end(), [](char& c){ c += 1; });` | 对每个字符执行自定义 Lambda 操作。 |
| **替换** | `std::replace(s.begin(), s.end(), 'l', 'L');` | 将区间内所有 `'l'` 替换为 `'L'`。 |
| **交换** | `std::swap(s1, s2);` | `s1.swap(s2)` 只需交换内部指针，不需要拷贝几万个字符。 |
| **最大值迭代器** | `std::max_element(s.begin(), s.end());` | 按 ASCII 码比较，返回最大字符的迭代器。 |
| **最小值迭代器** | `std::min_element(s.begin(), s.end());` | 按 ASCII 码比较，返回最小字符的迭代器。 |

::: details 点击查看代码示例：常用泛型函数
```cpp
#include <iostream>
#include <string>
#include <algorithm>
#include <numeric>

int main() {
    std::string s = "hello world";

    // 1. 排序与去重
    std::string s_sort = s;
    std::sort(s_sort.begin(), s_sort.end());
    s_sort.erase(std::unique(s_sort.begin(), s_sort.end()), s_sort.end());

    // 2. 移除指定字符（Erase-Remove 惯用法）
    std::string s_rem = s;
    auto it = std::remove(s_rem.begin(), s_rem.end(), 'l');
    s_rem.erase(it, s_rem.end()); // "heo word"

    // 3. 转大写与替换
    std::transform(s.begin(), s.end(), s.begin(), ::toupper); // "HELLO WORLD"
    std::replace(s.begin(), s.end(), 'L', '*');               // "HE**O WOR*D"

    // 4. 查找、统计与极值
    int cnt = std::count(s.begin(), s.end(), '*');
    auto max_it = std::max_element(s.begin(), s.end());

    std::cout << "unique: " << s_sort << "\nremoved: " << s_rem
              << "\ntransformed: " << s << "\ncount('*'): " << cnt
              << ", max char: " << *max_it << '\n';
    return 0;
}
```
:::

---

## 四、类型转换（数字、string 与 C 风格指针）

| 转换方向 | 函数 / 写法 | 说明与注意事项 |
| :--- | :--- | :--- |
| **数字转 `string`** | `std::to_string(123.45)` | 支持 `int`、`long`、`double` 等数值类型。 |
| **`string` 转数字** | `std::stoi("123")` / `std::stod("3.14")` / `std::stoll("...")` | 分别转为 `int`、`double`、`long long`。 |
| **转为 C 风格指针** | `s.c_str()` | **注意**：把 `string` 传给旧 C 语言接口（如 `printf`、`fopen`）时必须用它，返回 `const char*`（只读指针）。 |

::: details 点击查看代码示例：类型转换
```cpp
#include <iostream>
#include <cstdio>
#include <string>

int main() {
    std::string num_str = std::to_string(123.45);
    int a = std::stoi("123");
    double b = std::stod("3.14");
    long long c = std::stoll("10000000000");

    // 传给 C 风格 printf 必须使用 c_str()
    std::printf("num_str=%s, a=%d, b=%.2f, c=%lld\n", num_str.c_str(), a, b, c);
    return 0;
}
```
:::

---

## 五、C 风格字符串函数（`<cstring>` / `<cstdlib>`）

::: tip 使用前提
C++ 的 `std::string` 对象必须先调用 `c_str()` 转为 `const char*` 后，才能传给只读的 C 风格字符串函数。
:::

| 功能 | 函数原型 / 示例 | 重点提示 |
| :--- | :--- | :--- |
| **计算长度（不含 `\0`）** | `size_t strlen(const char* str);` | 遇到 `\0` 停止计数。 |
| **查找子串** | `const char* res = strstr(str, "World");` | 返回第一次出现子串的位置指针，没找到返回 `NULL`。 |
| **查找字符** | `char* strchr(const char* str, int ch);` | 返回第一次出现该字符的位置指针，没找到返回 `NULL`。 |
| **复制字符串** | `char* strcpy(char* dest, const char* src);` | 将源串（含 `\0`）复制到目标缓冲区；**无边界检查，易造成缓冲区溢出**。 |
| **整数转字符串** | `char* itoa(int value, char* buffer, int radix);` | 例：`itoa(255, buffer, 16);` -> `buffer = "ff"`（非 C++ 标准函数，仅部分编译器支持）。 |
| **字符串转整数** | `int atoi(const char* str);` | 转换失败或字符串为空时返回 `0`。 |
| **内存拷贝** | `void* memcpy(void* dest, const void* src, size_t count);` | 按字节拷贝 `count` 字节。 |
| **内存设置** | `void* memset(void* dest, int ch, size_t count);` | 将目标内存的前 `count` 个字节设置为指定值。 |
| **字符串拼接** | `char* strcat(char* dest, const char* src);` | 将源字符串追加到目标字符串后面（需保证 `dest` 空间足够）。 |

::: details 点击查看代码示例：C 风格字符串函数
```cpp
#include <iostream>
#include <cstring>
#include <cstdlib>

int main() {
    char buf[64] = {0};
    std::strcpy(buf, "Hello");
    std::strcat(buf, " World");

    std::cout << "len: " << std::strlen(buf) << '\n';
    if (const char* p = std::strstr(buf, "World")) {
        std::cout << "strstr found: " << p << '\n';
    }

    int val = std::atoi("42");
    std::cout << "atoi: " << val << '\n';

    char mem[10];
    std::memset(mem, 'A', 5);
    mem[5] = '\0';
    std::cout << "memset: " << mem << '\n';
    return 0;
}
```
:::