### Назва сесії:
**Модульна автоматизація маршрутизації моделей у Goose**

---

### Інструкція для реалізації автомодального вибору моделі

Щоб забезпечити автоматичний вибір моделі залежно від типу задачі, потрібно внести декілька змін до проєкту. Ось поетапний план:

---

#### **1. Додати функцію для класифікації типу задачі**
- Визначення задачі (наприклад, аналіз тексту, генерація текстів, робота з числовими даними) базується на ключових словах або типі вхідних даних.

**Кроки**:
1. **Файл**: custom_providers.rs
2. Додати нову функцію у цей файл для класифікації типу задач:
pub fn classify_task(task_description: &str) -> &str {
        if task_description.contains("analyze") || task_description.contains("summarize") {
            "analysis"
        } else if task_description.contains("generate") || task_description.contains("write") {
            "creative"
        } else if task_description.contains("calculate") || task_description.contains("data") {
            "numeric"
        } else {
            "default"
        }
    }

**Що робить функція**: аналізує текст запиту і повертає тип задачі (analysis, creative, numeric або default).

---

#### **2. Оновити логіку вибору моделі для відповідності задачі**

**Кроки**:
1. **Файл**: configure.rs
2. У функції select_model_from_list додати логіку, яка автоматично обирає модель залежно від типу задачі.
3. Внести наступний код:
- Шукати функцію select_model_from_list.
- Змінити її наступним чином:
fn select_model_from_list(
        models: &[String],
        provider_meta: &goose::providers::base::ProviderMetadata,
        task_description: &str
    ) -> Result<String, Box<dyn std::error::Error>> {
        let task_type = classify_task(task_description);

        // Фільтрація моделей залежно від типу задачі
        let recommended_models: Vec<String> = models.iter()
            .filter(|model| {
                match task_type {
                    "analysis" => model.contains("claude"),
                    "creative" => model.contains("gpt"),
                    "numeric" => model.contains("llama"),
                    _ => true, // Default case includes all models
                }
            })
            .cloned()
            .collect();

        // Якщо є рекомендовані моделі, пропонувати їх
        if !recommended_models.is_empty() {
            return Ok(cliclack::select("Select a model:")
                .items(
                    &recommended_models.iter()
                        .map(|model| (model.clone(), model.clone(), "Recommended"))
                        .collect::<Vec<_>>(),
                )
                .interact()?
                .to_string());
        }

        // Якщо немає рекомендацій, пропонувати базовий список
        Ok(cliclack::select("Select a model:")
            .items(
                &models.iter()
                    .map(|m| (m, m.as_str(), ""))
                    .collect::<Vec<_>>(),
            )
            .interact()?
            .to_string())
    }


3. Впровадити виклик цієї функції з третього параметра: task_description.

---

#### **3. Передача типу задачі у функцію**
1. **Файл**: configure.rs, функція configure_provider_dialog.
2. Виділити основну логіку виклику функції select_model_from_list:
// Задача користувача (запит можна отримати за замовчуванням або у вигляді тексту)
    let user_task_description = "Analyze customer feedback and provide a summary";

    let model: String = select_model_from_list(&models, provider_meta, user_task_description)?;


---

#### **4. Оптимальний варіант спрощення конфігурації**
- **Автоматизувати вибір моделі без участі користувача**.
- В обробнику configure_provider_dialog (та інших залежних функціях), після класифікації задачі, автоматично встановлювати першу рекомендовану модель:
if !recommended_models.is_empty() {
        model = recommended_models.first().unwrap().clone();
    }


---

#### **5. Тестування**
1. Переконатися, що вміст моделей GPT, Claude, Llama доступний:
- Визначений у відповідних провайдерах.
2. Додати інтеграційний тест:
- **Новий файл**: tests/model_routing.rs
#[test]
    fn test_model_routing_logic() {
        use goose::config::custom_providers::classify_task;

        assert_eq!(classify_task("Please analyze the report."), "analysis");
        assert_eq!(classify_task("Generate creative content for blog."), "creative");
        assert_eq!(classify_task("Calculate the sum of data."), "numeric");
    }


---

Ці зміни забезпечать динамічний вибір моделей залежно від контексту задач. Якщо потрібно, я можу підготувати фрагменти коду.
07:39 PM
підготуй і скажи де провести заміну
07:40 PM
Ось підготовлені фрагменти коду, які потрібно буде додати чи замінити у відповідних файлах, щоб інтегрувати систему автоматичного вибору моделі залежно від типу задачі.

---

### **1. Додати класифікатор задач**
**Файл**: custom_providers.rs

**Місце додавання**: На початку файлу після імпорту модулів.

**Додайте цей код:**
pub fn classify_task(task_description: &str) -> &str {
    if task_description.contains("analyze") || task_description.contains("summarize") {
        "analysis"
    } else if task_description.contains("generate") || task_description.contains("write") {
        "creative"
    } else if task_description.contains("calculate") || task_description.contains("data") {
        "numeric"
    } else {
        "default"
    }
}


---

### **2. Оновити функцію select_model_from_list**
**Файл**: configure.rs

**Місце оновлення**: Знайдіть функцію select_model_from_list.

Замість старої реалізації, вставте цей код:
fn select_model_from_list(
    models: &[String],
    provider_meta: &goose::providers::base::ProviderMetadata,
    task_description: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let task_type = classify_task(task_description);

    // Фільтрація моделей залежно від типу задачі
    let recommended_models: Vec<String> = models.iter()
        .filter(|model| {
            match task_type {
                "analysis" => model.contains("claude"),
                "creative" => model.contains("gpt"),
                "numeric" => model.contains("llama"),
                _ => true, // Default case includes all models
            }
        })
        .cloned()
        .collect();

    // Якщо є рекомендовані моделі, пропонувати їх
    if !recommended_models.is_empty() {
        return Ok(cliclack::select("Select a model (Recommended models):")
            .items(
                &recommended_models.iter()
                    .map(|model| (model.clone(), model.clone(), "Recommended"))
                    .collect::<Vec<_>>(),
            )
            .interact()?
            .to_string());
    }

    // Якщо немає рекомендацій, пропонувати базовий список
    Ok(cliclack::select("Select a model:")
        .items(
            &models.iter()
                .map(|m| (m, m.as_str(), ""))
                .collect::<Vec<_>>(),
        )
        .interact()?
        .to_string())
}


---

### **3. Передача типу задач до select_model_from_list**
**Файл**: configure.rs

**Місце оновлення**: У функції configure_provider_dialog.

Знайдіть і оновіть цей фрагмент:
// Старий код: виклик select_model_from_list
let model: String = select_model_from_list(&models, provider_meta)?;


**Замініть на новий код:**
// Новий код: передача опису задачі для кращої автоматизації
let user_task_description = "Analyze customer feedback and provide a summary"; // або отримайте це значення з користувача
let model: String = select_model_from_list(&models, provider_meta, user_task_description)?;


---

### **4. Опціонально: Тестування класифікатора**
**Файл для тестів**: створіть новий файл tests/model_routing.rs.

**Вміст файлу:**
#[cfg(test)]
mod tests {
    use goose::config::custom_providers::classify_task;

    #[test]
    fn test_classify_task() {
        assert_eq!(classify_task("Please analyze the report."), "analysis");
        assert_eq!(classify_task("Generate creative content for blog."), "creative");
        assert_eq!(classify_task("Calculate the sum of data."), "numeric");
        assert_eq!(classify_task("Explain this to me."), "default");
    }
}


Запустіть тести командою:
cargo test --test model_routing


---

### Сума змін:
1. **Додати функцію classify_task** у файл custom_providers.rs.
2. **Оновити функцію select_model_from_list** у файл configure.rs.
3. **Передати тип задачі у select_model_from_list** у функції configure_provider_dialog.
4. **Опціонально: Додати автоматичне тестування для класифікатора задач.**

Готовий допомогти, якщо потрібні уточнення або допомога в реалізації! 🚀
07:40 PM