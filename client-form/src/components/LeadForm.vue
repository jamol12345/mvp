<!--
  LeadForm.vue — self-contained lead submission component.

  Submits to POST ${API_BASE}/api/leads with body:
  { fullName?, phone, priorities, language }

  API_BASE: import.meta.env.VITE_API_URL
-->
<template>
  <form @submit.prevent="onSubmit" class="lead-form">
    <div class="form-group">
      <label for="fullName">ФИО <span class="optional-hint">(необязательно)</span></label>
      <input
        id="fullName"
        v-model.trim="form.fullName"
        type="text"
        placeholder="Введите ФИО"
      />
    </div>

    <div class="form-group">
      <label for="phone">Телефон <span class="required">*</span></label>
      <input
        id="phone"
        v-model.trim="form.phone"
        type="tel"
        placeholder="Введите телефон"
        required
      />
    </div>

    <div class="form-group">
      <label>Приоритеты</label>
      <p class="priority-hint">Выберите один или несколько вариантов</p>
      <div class="priority-buttons" role="group">
        <button
          v-for="opt in PRIORITY_OPTIONS"
          :key="opt"
          type="button"
          class="priority-btn"
          :class="{ selected: form.priorities.includes(opt) }"
          @click="togglePriority(opt)"
        >
          {{ opt }}
        </button>
      </div>
    </div>

    <p v-if="submitError" class="error-message">{{ submitError }}</p>
    <p v-if="submitSuccess" class="success-message">Ваши данные успешно отправлены. Мы свяжемся с вами в течение 24 часов.</p>

    <button type="submit" class="btn-submit" :disabled="loading">
      {{ loading ? 'Отправка...' : 'Отправить' }}
    </button>
  </form>
</template>

<script setup>
import { ref, reactive } from 'vue'

const PRIORITY_OPTIONS = [
  'Качество и надежность',
  'Цена',
  'Дизайн и стиль',
  'Гарантии и сервис',
  'Надежность и безопасность',
]

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL != null && String(import.meta.env.VITE_API_URL).trim() !== '')
  ? String(import.meta.env.VITE_API_URL).trim().replace(/\/$/, '')
  : 'https://crm-kukcha.vercel.app'

const form = reactive({
  fullName: '',
  phone: '',
  priorities: [],
  language: 'ru',
})

const loading = ref(false)
const submitError = ref('')
const submitSuccess = ref(false)

function togglePriority(opt) {
  const idx = form.priorities.indexOf(opt)
  if (idx >= 0) {
    form.priorities.splice(idx, 1)
  } else {
    form.priorities.push(opt)
  }
}

function validate() {
  submitError.value = ''
  if (!form.phone || !String(form.phone).trim()) {
    submitError.value = 'Введите телефон.'
    return false
  }
  return true
}

async function onSubmit() {
  submitSuccess.value = false
  if (!validate()) return

  loading.value = true
  submitError.value = ''

  const body = {
    fullName: form.fullName.trim(),
    phone: form.phone.trim(),
    priorities: [...form.priorities],
    language: form.language,
  }

  const url = `${API_BASE}/api/leads`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      submitSuccess.value = true
      form.fullName = ''
      form.phone = ''
      form.priorities = []
    } else if (res.status === 400) {
      submitError.value = (data && data.error) || 'Проверьте данные и попробуйте снова.'
    } else {
      submitError.value = (data && data.error) || 'Ошибка сервера. Попробуйте позже.'
    }
  } catch (err) {
    console.error('Lead submit error:', err)
    submitError.value = 'Ошибка сети. Проверьте подключение и попробуйте снова.'
  } finally {
    loading.value = false
  }
}
</script>
