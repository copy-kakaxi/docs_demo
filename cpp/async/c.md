# C++ 模板的实例化与具体化（特化）

## 简介

学习 C++ 模板时，经常遇到几个非常相似的术语：**实例化、隐式实例化、显式实例化、具体化、显式具体化、全特化、偏特化**。如果只记住写法，很容易把它们混为一谈。

本文主要回答两个问题：

1. **实例化（Instantiation）**：什么时候根据模板形成具体的函数、类等实体？
2. **特化（Specialization）**：什么时候针对特定的模板参数使用专门的实现？

::: tip 先记住结论
- **隐式实例化**：代码使用了模板，编译器按需实例化。
- **显式实例化**：程序员明确要求为指定参数实例化模板。
- **全特化（显式特化）**：为一组完全确定的模板参数提供专门实现。
- **偏特化**：为满足特定参数模式的一类模板实参提供专门实现。

**“半实例化”不是 C++ 标准术语**，你想说的通常是“偏特化”；而“具体化”在不少中文教材中通常指“特化”，其中“显式具体化”通常就是“显式特化”。
:::

---

## 一、先理清这些概念的关系

以下是一个便于记忆的**教学分类**，不是 C++ 标准术语的严格树状定义：

```text
                        C++ 模板（Template）
                                 │
                   ┌─────────────┴─────────────┐
                   │                           │
          实例化 Instantiation            特化 Specialization
          （形成具体实体）                  （专门的实现/匹配）
                   │                           │
           ┌───────┴───────┐          ┌────────┴────────┐
           │               │          │                 │
        隐式实例化       显式实例化      全特化             偏特化
         Implicit        Explicit     Full              Partial
           │               │          │                 │
        按需发生       明确要求生成   模板参数全确定       约束参数模式
```

| 你听到的名称 | 对应英文 | 最核心的区别 | 典型写法 |
| --- | --- | --- | --- |
| 隐式实例化 | Implicit Instantiation | 编译器按需实例化 | `add(1, 2);` |
| 显式实例化 | Explicit Instantiation | 程序员明确要求实例化 | `template int add<int>(int, int);` |
| 全特化 / 显式特化 | Full / Explicit Specialization | 对确定的模板实参提供特殊实现 | `template<> class Data<int, double> { ... };` |
| 偏特化 / 部分特化 | Partial Specialization | 对一类满足模式的实参提供特殊实现 | `template<class U> class Data<int, U> { ... };` |

::: warning “特化”一词还有广义用法
C++ 标准中的 **specialization** 也可能泛指通过实例化得到的特定实体，因此从标准术语角度，不能把“实例化”和“特化”视为完全互不相交的集合。

但在学习“全特化、偏特化”的语境中，**特化通常指程序员提供的专门模板实现**。本文以下主要采用这一常见教学用法。
:::

---

## 二、模板本身是什么？

先看一个普通函数模板：

```cpp
template<typename T>
T add(T a, T b)
{
    return a + b;
}
```

在这里：

- `template<typename T>` 声明模板参数 `T`。
- `add` 是一个**函数模板**，不是一个已经固定为 `int` 或 `double` 的普通函数。
- 编译器可以根据需要为不同的 `T` 形成对应的函数模板实例。

类模板也一样：

```cpp
template<typename T>
class Box
{
public:
    T value;
};
```

`Box` 是类模板；`Box<int>` 则指向用 `int` 作为模板实参的一个具体类模板特化。

::: details 展开详细解答：类模板和函数模板会在什么时候真正实例化？

**简答：**不是写出任何带尖括号的名字，就必定需要完整实例化；是否需要实例化，取决于代码是否要求该实体的完整定义。

```cpp
template<typename T>
class Box {
public:
    T value;
};

Box<int>* ptr = nullptr; // 只声明一个指针，一般不要求实例化完整类定义
Box<int> obj;            // 创建对象，需要完整类定义
```

函数模板一般在调用等需要定义的情况下发生隐式实例化；类模板的成员函数也并非在类模板被实例化时就一律全部生成，通常是在需要成员函数定义时再按需实例化。

因此，**“模板实例化 = 编译器无条件复制全部模板代码”**是不准确的。
:::

---

## 三、隐式实例化（Implicit Instantiation）

### 1. 定义及代码示例

**隐式实例化**：编译器在需要某个模板实例时，根据模板和推导得到或明确给出的模板实参，按规则实例化对应实体。

```cpp
#include <iostream>

template<typename T>
T add(T a, T b)
{
    return a + b;
}

int main()
{
    std::cout << add(10, 20) << '\n';       // 推导 T = int
    std::cout << add(1.5, 2.5) << '\n';     // 推导 T = double
    std::cout << add<int>(3, 4) << '\n';    // 显式指定 T，但仍是隐式实例化
}
```

可以在概念上把前两种调用理解为需要如下函数：

```cpp
// 示意代码：不是你要手动编写的内容
int add(int a, int b) {
    return a + b;
}

double add(double a, double b) {
    return a + b;
}
```

::: warning 显式指定模板实参 ≠ 显式实例化
```cpp
add<int>(3, 4);                 // 普通调用，显式指定模板实参

template int add<int>(int, int); // 显式实例化定义
```

这两句虽然都写了 `<int>`，但**完全不是一回事**。

另外，上面的“示意代码”只帮助理解，编译器最终是否输出单独的机器函数、是否内联、是否消除重复实体，都可能受编译及链接优化影响。
:::

### 2. 隐式实例化的基本过程

```text
定义函数模板 add<T>()
          │
          ▼
调用 add(10, 20)
          │
          ▼
模板实参推导：T = int
          │
          ▼
确定要调用的函数模板特化
          │
          ▼
需要定义时执行隐式实例化
          │
          ▼
得到可供本次调用使用的 add<int>
```

核心是：**没有写显式实例化指令，编译器在使用模板时按需完成实例化。**

---

## 四、显式实例化（Explicit Instantiation）

### 1. 显式实例化定义

如果希望明确要求编译器实例化某个模板实例，可以写：

```cpp
template<typename T>
T add(T a, T b)
{
    return a + b;
}

// 显式实例化定义（Explicit Instantiation Definition）
template int add<int>(int, int);
template double add<double>(double, double);
```

第一句的意思是：**对 `T = int` 使用现有的 `add` 模板定义进行实例化**，不是替 `int` 重新编写算法。

特别注意：

```cpp
template int add<int>(int, int);
```

这里开头写的是 `template`，**不是 `template<>`**。

### 2. 显式实例化声明：`extern template`

显式实例化除了定义，还有声明形式：

```cpp
extern template int add<int>(int, int);  // 显式实例化声明
```

它通常表示：**这个翻译单元不要按通常方式隐式实例化该函数模板的这份定义，实例化定义由别的翻译单元提供。**

| 语句 | 名称 | 用途 |
| --- | --- | --- |
| `template int add<int>(int, int);` | 显式实例化定义 | 明确实例化指定版本 |
| `extern template int add<int>(int, int);` | 显式实例化声明 | 抑制当前翻译单元对应的通常隐式实例化 |

::: details 展开详细解答：显式实例化有什么用？如何跨 `.h` 和 `.cpp` 分工？

模板定义经常放在头文件中，供不同翻译单元使用。对项目里经常使用的固定模板实参，可以集中提供显式实例化定义。

**add.h**

```cpp
#pragma once

template<typename T>
T add(T a, T b)
{
    return a + b;
}

// 声明：其他翻译单元负责提供 add<int> 的实例化定义
extern template int add<int>(int, int);
```

**add.cpp**

```cpp
#include "add.h"

// 定义：集中提供 add<int> 的显式实例化定义
template int add<int>(int, int);
```

**main.cpp**

```cpp
#include "add.h"
#include <iostream>

int main()
{
    std::cout << add(10, 20) << '\n';
}
```

这里把 `add<int>` 的实例化定义集中在 `add.cpp`，`main.cpp` 调用时使用该定义提供的实体。典型收益是减少不同翻译单元里对同一模板实例的重复实例化工作；实际编译时间和最终代码大小收益取决于项目、编译器与链接器。

**注意：**如果使用 `extern template` 却没有在其他翻译单元提供相应定义，可能出现链接错误。它不是“让模板自动完成特化”的开关。

:::

---

## 五、具体化 / 特化（Specialization）

前面的实例化主要讨论：**基于已有的模板定义产生具体实体**。

现在换一种需求：对于某些特定类型，原来的通用实现并不合适，希望**为它们提供另外一套实现**。这就是日常教学中说的“模板特化”。

先定义类模板（也叫**主模板 / Primary Template**）：

```cpp
template<typename T1, typename T2>
class Data
{
public:
    void print() const
    {
        std::cout << "主模板" << '\n';
    }
};
```

### 1. 全特化（Full Specialization / Explicit Specialization）

假设我们希望：**只有当模板参数恰好是 `int` 和 `double` 时，使用专门实现。**

```cpp
// 为 Data<int, double> 提供全特化定义
template<>
class Data<int, double>
{
public:
    void print() const
    {
        std::cout << "全特化版本" << '\n';
    }
};
```

观察语法：

- `template<>`：没有剩余的模板参数需要声明。
- `Data<int, double>`：两个模板参数都被确定了。
- 类内部重新提供了自己的实现（示例里为新的 `print()`）。

所以全特化可以理解为：**给一组完全确定的模板实参单独准备一个版本。**

```cpp
Data<int, double> a; // 使用上面的全特化
Data<char, float> b; // 使用主模板（假设没有其他匹配的偏特化）
```

::: details 展开详细解答：为什么叫“显式特化”，它与“显式实例化”到底差在哪里？

因为我们明确写出了新的实现：

```cpp
// 显式实例化：沿用现有的主模板实现
template class Data<int, double>;
```

与：

```cpp
// 显式特化：重新提供一份完整的类定义
template<>
class Data<int, double>
{
    // 完全独立的实现
};
```

两者的语法和语义都不同，**不应在同一示例中试图对同一个特化同时按上述方式定义**。上面两段仅作互斥方案对照。

另外，全特化定义不是“继承主模板的成员后改写一部分”。类模板全特化有自己独立的类定义，主模板的成员不会自动出现在全特化中。

:::

### 2. 偏特化（Partial Specialization）

再改变需求：**只要求第一个模板参数是 `int`，第二个参数可以是任何类型。**

```cpp
template<typename T2>
class Data<int, T2>
{
public:
    void print() const
    {
        std::cout << "偏特化版本" << '\n';
    }
};
```

这里的变化是：

- 第一个参数固定为 `int`。
- 第二个参数 `T2` 仍然可以变化。
- 只要实参满足这个模式，就可能选择该偏特化。

```cpp
Data<int, char>   a;  // 偏特化
Data<int, float>  b;  // 偏特化
Data<char, float> c;  // 主模板
Data<int, double> d;  // 如果已定义全特化，则使用全特化
```

::: tip 偏特化并不意味着“恰好固定一半参数”
偏特化针对的是**一类更受限制的模板实参模式**。例如：

```cpp
// 指定第一个类型必须是指针
// 注意：这些是说明参数模式的独立例子

template<typename T, typename U>
class PairLike {}; // 主模板

template<typename T, typename U>
class PairLike<T*, U> {}; // 偏特化：第一个参数是指针

template<typename T>
class PairLike<T, T> {};  // 偏特化：两个参数类型相同
```

上述两个偏特化模式可能在某些实参下都匹配，例如 `PairLike<int*, int*>`；编译器必须依据偏序规则选出唯一更特化的候选，否则会报二义性错误。**不是所有看起来都能匹配的偏特化，都能自动确定唯一赢家。**
:::

### 3. 主模板、偏特化、全特化的选择结果

假设三份定义均已存在：

```cpp
// ① 主模板
template<typename T1, typename T2>
class Data { /* ... */ };

// ② 偏特化
template<typename T2>
class Data<int, T2> { /* ... */ };

// ③ 全特化
template<>
class Data<int, double> { /* ... */ };
```

| 使用方式 | 选中的版本 | 原因 |
| --- | --- | --- |
| `Data<char, float>` | 主模板 | 不满足特殊参数模式 |
| `Data<int, char>` | 偏特化 | 满足 `Data<int, T2>` |
| `Data<int, float>` | 偏特化 | 满足 `Data<int, T2>` |
| `Data<int, double>` | 全特化 | 存在这一确定实参组合的专门定义 |
| `Data<double, int>` | 主模板 | 第一个参数不是 `int` |

**理解顺序：**先看有没有适用的专门版本，再按语言规则选定使用哪个定义；所需的具体类及其成员则依据实例化规则形成。

---

## 六、函数模板与类模板的特化限制

| 模板种类 | 全特化 | 偏特化 |
| --- | --- | --- |
| 类模板 | 支持 | 支持 |
| 函数模板 | 支持 | **不支持** |
| 变量模板（C++14 起） | 支持 | 支持 |

### 1. 函数模板可以全特化

```cpp
#include <iostream>

template<typename T>
void show(T value)
{
    std::cout << "普通版本: " << value << '\n';
}

// 函数模板全特化：T = int
template<>
void show<int>(int value)
{
    std::cout << "int 专门版本: " << value << '\n';
}
```

### 2. 函数模板不能偏特化，但可以重载

下面的“函数模板偏特化”写法不合法：

```cpp
// 错误示意，不可编译
template<typename T>
void show<T*>(T* p)
{
}
```

若想针对指针参数提供不同处理，可以用**函数模板重载**：

```cpp
#include <iostream>

template<typename T>
void show(T value)
{
    std::cout << "普通参数" << '\n';
}

template<typename T>
void show(T* value) // 这是新的函数模板重载，不是偏特化
{
    std::cout << "指针参数" << '\n';
}

int main()
{
    int n = 42;
    show(n);   // 普通参数
    show(&n);  // 指针参数
}
```

::: warning 函数模板重载与函数模板全特化不是同一套机制
函数模板重载会参与重载决议；函数模板的显式特化通常不能被理解为一个独立的重载候选。编译器先进行重载决议，选出主函数模板对应的候选，再考虑与之关联的显式特化。

因此，当需求是“根据不同参数类型设计不同的函数调用路径”时，**通常优先考虑重载**，不要把函数模板全特化当成一般重载的完全替代品。
:::

---

## 七、一份可以直接编译的完整示例

下面把**主模板、偏特化、全特化、隐式实例化和显式实例化**放到同一份示例里。

```cpp
#include <iostream>

// 1. 主类模板
template<typename T1, typename T2>
class Data
{
public:
    void print() const
    {
        std::cout << "主模板" << '\n';
    }
};

// 2. 偏特化：第一个参数为 int
template<typename T2>
class Data<int, T2>
{
public:
    void print() const
    {
        std::cout << "偏特化" << '\n';
    }
};

// 3. 全特化：两个参数恰好为 int、double
template<>
class Data<int, double>
{
public:
    void print() const
    {
        std::cout << "全特化" << '\n';
    }
};

// 4. 函数模板
template<typename T>
T add(T a, T b)
{
    return a + b;
}

// 5. 对 add<int> 进行显式实例化定义
template int add<int>(int, int);

int main()
{
    Data<char, float> a;
    Data<int, char> b;
    Data<int, double> c;

    a.print(); // 主模板
    b.print(); // 偏特化
    c.print(); // 全特化

    std::cout << add(1.5, 2.5) << '\n'; // add<double>：按需隐式实例化
    std::cout << add(10, 20) << '\n';   // 使用 add<int>：已有显式实例化定义
}
```

**预期输出：**

```text
主模板
偏特化
全特化
4
30
```

::: details 展开详细解答：这一份代码里，究竟哪里是“特化”，哪里是“实例化”？

1. 定义 `Data<T1, T2>`：提供**主类模板**。
2. 定义 `Data<int, T2>`：提供**类模板偏特化**。
3. 定义 `Data<int, double>`：提供**类模板全特化**。
4. 创建 `Data<char, float> a`：需要相应的具体类定义，选择主模板并按需实例化。
5. 创建 `Data<int, char> b`：选择偏特化，再按需实例化具体的类。
6. 创建 `Data<int, double> c`：使用已经明确给出的全特化类定义。
7. `template int add<int>(int, int);`：显式实例化定义，**不是**函数模板全特化。
8. `add(1.5, 2.5)`：`T` 推导为 `double`，按需隐式实例化。

注意：第 6 点的全特化是已经定义好的具体类，不需要再次通过主模板来实例化整个类定义。这说明“所有特化都必须再由主模板实例化”也是一种误解。

:::

---

## 八、几个最容易混淆的问题

### 1. `add<int>(1, 2)` 是显式实例化吗？

::: details 展开详细解答：显式指定模板实参，与显式实例化不是一回事

不是。`add<int>(1, 2)` 只是**在调用时显式指定模板实参**，该函数的定义如果需要生成，仍属于通常的隐式实例化情形。

```cpp
add<int>(1, 2);                 // 调用：显式指定 T=int

template int add<int>(int, int); // 显式实例化定义
```

判断显式实例化要看**是否存在 `template ...;` 这样的实例化声明或定义**，不能只看代码中有没有 `<int>`。

:::

### 2. `template<>` 和 `template<typename T>` 到底有什么区别？

::: details 展开详细解答：三个长得很像的语法

```cpp
// 主模板：声明一个可以变化的模板参数
template<typename T>
class Box {};

// 全特化：模板参数已全部确定
template<>
class Box<int> {};

// 显式实例化（这里仅作语法对照，
// 不要与上面 Box<int> 的全特化作为同一套定义使用）
// template class Box<int>;
```

- `template<typename T>`：声明模板参数。
- `template<>`：显式特化的语法标志；在这个例子里参数都固定了。
- `template class Box<int>;`：显式实例化定义，沿用可用模板定义，不是新写一个类。

:::

### 3. 前后两个尖括号 `<>` 的语法规律是什么？

::: details 展开详细解答：一句话分清四种模板写法的前后尖括号

观察 `template` 关键字后面（前括号）和类名/函数名后面（后括号）的尖括号规律，可以快速区分它们：

| 模板种类 | 前面 `template` 后的 `<>` | 模板名/函数名后面的 `<>` | 代码示例 |
| :--- | :--- | :--- | :--- |
| **普通主模板** | **必须有**，且里面必须有参数 | **绝对不能有** `<>` | `template<typename T>`<br>`class Box {};` |
| **显式实例化** | **绝对不能有** `<>`（只有 `template`） | **必须有**，且写满具体类型 *(注)* | `template class Box<int>;` |
| **全特化** | **必须有**，且里面**必须是空的** `<>` | **必须有**，且写满具体类型 *(注)* | `template<>`<br>`class Box<int> {};` |
| **偏特化** | **必须有**，里面放**剩余的**模板参数 | **必须有**，写满完整参数列表 | `template<typename T>`<br>`class Box<T*> {};` |

> **注：**对于**函数模板**的显式实例化或全特化，如果编译器能从函数参数列表中直接推导出类型，函数名后面的 `<int>` 可以省略（例如 `template void print(int);` 或 `template<> void print(int a) {}`），但显式写上 `<int>` 永远合法。

**记忆口诀：**
- **前无、后有**：显式实例化（`template class A<int>;`）
- **前有、后无**：普通主模板（`template<class T> class A;`）
- **前空、后有**：全特化（`template<> class A<int>;`）
- **前有、后也有**：偏特化（`template<class T> class A<T*>;`）

:::

### 4. 特化之前必须先有普通模板（主模板）的定义吗？

::: details 展开详细解答：只需要主模板的“声明”，不需要“定义”

这个机制有点像“函数重写前要有虚函数”，但比虚函数更灵活：**全特化和偏特化之前，必须先有主模板的声明，但主模板不一定要有定义（实现体）。**

这在类型萃取（Type Traits）和模板元编程中非常常用——如果我们只允许特定类型通过编译，通用类型直接报错，就会故意只写主模板的前向声明：

```cpp
// 只有前向声明，没有定义（没有花括号实现）
template<typename T>
struct MyTypeTraits;

// 合法！只要主模板声明过了，就可以特化
template<>
struct MyTypeTraits<int> {
    static constexpr bool is_int = true;
};

// MyTypeTraits<double> a; // 编译报错：使用了未定义的类型（通用版本未定义）
// MyTypeTraits<int> b;    // 编译通过！使用了全特化版本
```

**注意：**主模板的声明必须写在特化版本**之前**，且在调用模板之前编译器必须能看到特化版本的声明。

:::

### 5. `template<typename T = int>` 这种写默认值是什么操作？和特化有什么区别？

::: details 展开详细解答：默认模板参数（Default Template Arguments）

在主模板的尖括号中写 `= XX`（例如 `template<typename T = int>`），叫做**默认模板参数**。它和**普通函数的默认参数**逻辑一致：当调用者没有显式指定该模板参数时，编译器自动使用默认类型补上。

```cpp
template<typename T = int, typename Container = std::vector<T>>
class MyStack {
    Container data;
};

MyStack<double, std::deque<double>> s1; // 全部自己指定
MyStack<double> s2;                     // 第二个参数自动用默认类型 std::vector<double>
MyStack<> s3;                           // 全部用默认值（T = int）
```

**它与特化的本质区别：**
- **默认模板参数 (`typename T = int`)**：依然属于**普通主模板**，只是省去手动指定类型的麻烦，底层跑的仍是同一套通用逻辑。
- **特化 (`template<> class MyStack<int>`)**：是为 `int` **彻底重写了一套不同的代码逻辑**。

**使用规则注意：**
1. **必须从右向左连续提供**：在类模板中，若某个参数给了默认值，它右边的所有参数都必须有默认值。
2. **只能在主模板中写**：写**全特化**或**偏特化**时，尖括号里绝对不能出现 `= 默认类型`，否则编译报错。
3. **不能重复指定**：若声明与定义分离，默认值只能写在一个地方（通常写在声明处）。

:::

### 6. 偏特化以后还会发生实例化吗？

::: details 展开详细解答：特化选择与实例化可以连续发生

会。例如：

```cpp
template<typename T, typename U>
class Data {};

template<typename U>
class Data<int, U> {};

Data<int, char> x;
```

其中 `Data<int, U>` 是**偏特化模板**，仍保留模板参数 `U`；创建对象 `x` 时，可以用 `U = char` 对这个偏特化进行隐式实例化。

也就是说：**偏特化定义了一套更具体的模板规则，而 `Data<int, char>` 是该规则的具体应用。**

:::

### 7. 全特化以后，为什么不再沿用主模板里的成员？

::: details 展开详细解答：类模板全特化是一套独立的类定义

```cpp
template<typename T>
class Box {
public:
    void hello() {}
};

template<>
class Box<int> {
public:
    void world() {}
};

int main() {
    Box<int> x;
    x.world(); // 正确
    // x.hello(); // 错误：全特化没有自动获得主模板的 hello()
}
```

全特化不是“修改主模板里的少数方法后继承其余内容”；如果需要通用逻辑，可以显式复用辅助类、基类或普通函数。

:::

### 8. 全特化和偏特化都能匹配时，究竟选谁？

::: details 展开详细解答：具体匹配与潜在二义性

在前面的案例中：

```cpp
Data<int, double> x;
```

存在精确的 `Data<int, double>` 全特化时，使用这份明确给出的专门类定义，而不是直接采用 `Data<int, T2>`。

但如果只有**多个偏特化**，就需要用偏序规则判断哪个更特化。如果不存在唯一最合适的版本，程序可能出现二义性并无法通过编译。例如：

```cpp
template<typename T, typename U>
class Data {};

template<typename U>
class Data<int, U> {};

template<typename T>
class Data<T, int> {};

// Data<int, int> obj; // 二义性：两份偏特化都匹配
```

因此不能简单地记成“编译器总会自动选一个看起来最特殊的”。

:::

### 9. 全特化能不能写在第一次使用之后？

::: details 展开详细解答：声明顺序的重要性

对于可能引起隐式实例化的使用，**对应的显式特化声明应当在之前就可见**，否则可能违反语言规则。

```cpp
template<typename T>
class Box {};

// 正确：在相关使用之前声明全特化
template<>
class Box<int>;

// 此时可以先声明指针（无需完整定义）
Box<int>* p = nullptr;

// 之后再给出全特化的完整定义
template<>
class Box<int> {
public:
    int value = 0;
};

Box<int> obj;
```

显式特化的声明与定义要放在合适的命名空间作用域，并保证相关翻译单元中的声明可见性。对于需要完整类定义的对象，必须先看到其定义。

:::

---

## 九、个人总结

### 1. 我应该如何快速判断这几种语法？

遇到一个模板代码片段时，可以按这个顺序判断：

```text
                   看到一段模板相关代码
                            │
                            ▼
                 是否在提供新的专门实现？
                     │             │
                    是             否
                     │             │
                     ▼             ▼
              是否使用 template<>？   是否是 template ...; 形式？
                 │        │          │             │
                是        否         是             否
                 │        │          │             │
                 ▼        ▼          ▼             ▼
              全特化    检查是否    显式实例化      普通模板使用
                        是偏特化                   （通常按需
                                                  隐式实例化）
```

::: warning 这只是初学时的快速判断法
实际判断还要结合完整语法、声明所在上下文、是否为函数重载以及模板参数匹配规则。比如 `template<typename T> class Data<int,T>` 才是类模板偏特化，不能只凭出现了 `template<typename T>` 就断言它是主模板。
:::

### 2. 最值得背下来的对照表

| 比较项目 | 实例化 | 特化（常见教学含义） |
| --- | --- | --- |
| 要解决什么问题？ | 形成某个模板实参对应的实体 | 为特定实参或模式准备专门实现 |
| 是否必须修改原来的实现？ | 不需要 | 通常提供另一份实现 |
| 重要分类 | 隐式实例化、显式实例化 | 全特化、偏特化 |
| 常见代码 | `template int add<int>(int, int);` | `template<> class Box<int> {};` |
| 能否一起出现？ | 可以与选择偏特化等行为结合 | 偏特化本身也可以被实例化 |

### 3. 最后需要记住的六句话

1. **模板**是一份可针对不同实参使用的通用定义。
2. **隐式实例化**通常由代码的使用需求触发，编译器按需处理。
3. **显式实例化**通过 `template ...;` 明确要求实例化，并不重写算法。
4. **全特化**通过 `template<>` 为确定的模板实参组合提供专门实现。
5. **偏特化**为某一类受限制的模板参数模式提供专门实现；函数模板不能偏特化。
6. **特化和实例化可以共同出现**：先确定适用的模板定义（如偏特化），再按需要形成具体实体。

::: tip 一句话概括
**实例化关心“具体实体怎样形成”，特化关心“特定参数应该使用哪一份专门定义”。**

记语法时尤其注意：`add<int>()`、`template int add<int>(...);`、`template<> void add<int>(...) { ... }` 是三种不同的事情。
:::