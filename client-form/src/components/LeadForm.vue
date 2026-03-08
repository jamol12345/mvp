<!--
  LeadForm.vue — self-contained lead submission component.

  Required props: none. Component is ready to use as-is.

  API integration:
  - Submits to POST ${API_BASE}/api/leads
  - API_BASE comes from import.meta.env.VITE_API_URL (see .env / .env.example)
  - To change API URL: set VITE_API_URL in .env (e.g. VITE_API_URL=https://crm-kukcha.vercel.app)
  - For same-origin deployment, use VITE_API_URL= (empty) so requests go to current host.

  How to plug into existing Vue project:
  - Copy this file into your components folder
  - Ensure VITE_API_URL is set in your env (or pass apiBase as prop if you add it)
  - Body shape must match backend: fullName, doorType, measurements, phoneNumber, priorities, language, length, width, dobor
-->
<template>
  <form @submit.prevent="onSubmit" class="lead-form">
    <div class="form-group">
      <label for="fullName">ФИО <span class="required">*</span></label>
      <input
        id="fullName"
        v-model.trim="form.fullName"
        type="text"
        placeholder="Введите ФИО"
        required
      />
    </div>

    <div class="form-group">
      <label for="doorType">Выбранная дверь <span class="required">*</span></label>
      <select id="doorType" v-model="form.doorType" required>
        <option value="">Выберите тип двери</option>
        <option value="Standard Door">Стандартная дверь</option>
        <option value="Premium Door">Премиум дверь</option>
        <option value="Custom Door">Индивидуальная дверь</option>
      </select>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="length">Длина (см) <span class="required">*</span></label>
        <input
          id="length"
          v-model.number="form.length"
          type="number"
          min="1"
          step="1"
          placeholder="см"
          required
        />
      </div>
      <div class="form-group">
        <label for="width">Ширина (см) <span class="required">*</span></label>
        <input
          id="width"
          v-model.number="form.width"
          type="number"
          min="1"
          step="1"
          placeholder="см"
          required
        />
      </div>
    </div>

    <div class="form-group">
      <label for="dobor">Добор</label>
      <input
        id="dobor"
        v-model.trim="form.dobor"
        type="text"
        placeholder="Опционально"
      />
    </div>

    <div class="form-group">
      <label>Что для вас важнее всего? <span class="required">*</span></label>
      <p class="priority-hint">Выберите ровно 2 варианта</p>
      <div class="priority-buttons" role="group">
        <button
          v-for="opt in PRIORITY_OPTIONS"
          :key="opt"
          type="button"
          class="priority-btn"
          :class="{
            selected: form.priorities.includes(opt),
            disabled: form.priorities.length >= 2 && !form.priorities.includes(opt),
          }"
          @click="togglePriority(opt)"
        >
          {{ opt }}
        </button>
      </div>
      <p v-if="priorityError" class="error-message">{{ priorityError }}</p>
    </div>

    <div class="form-group">
      <label for="phoneNumber">Телефон <span class="required">*</span></label>
      <input
        id="phoneNumber"
        v-model.trim="form.phoneNumber"
        type="tel"
        placeholder="Введите телефон"
        required
      />
    </div>

    <p v-if="submitError" class="error-message">{{ submitError }}</p>
    <p v-if="submitSuccess" class="success-message">Ваши данные успешно отправлены. Мы свяжемся с вами в течение 24 часов.</p>

    <button type="submit" class="btn-submit" :disabled="loading">
      {{ loading ? 'Отправка...' : 'Отправить' }}
    </button>
  </form>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'

// Priority options — must match backend allowed list exactly
const PRIORITY_OPTIONS = [
  'Качество и надежность',
  'Цена',
  'Дизайн и стиль',
  'Гарантии и сервис',
  'Надежность и безопасность',
]

// API base URL: set in .env as VITE_API_URL. Direct connection to backend (no proxy).
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL != null && String(import.meta.env.VITE_API_URL).trim() !== '')
  ? String(import.meta.env.VITE_API_URL).trim().replace(/\/$/, '')
  : 'https://crm-kukcha.vercel.app'

const form = reactive({
  fullName: '',
  phoneNumber: '',
  doorType: '',
  length: null,
  width: null,
  dobor: '',
  priorities: [],
  language: 'ru',
})

const loading = ref(false)
const submitError = ref('')
const submitSuccess = ref(false)
const priorityError = ref('')

function togglePriority(opt) {
  const idx = form.priorities.indexOf(opt)
  if (idx >= 0) {
    form.priorities.splice(idx, 1)
  } else if (form.priorities.length < 2) {
    form.priorities.push(opt)
  }
  priorityError.value = ''
}

function validate() {
  priorityError.value = ''
  submitError.value = ''

  if (!form.fullName?.trim()) {
    submitError.value = 'Заполните ФИО.'
    return false
  }
  if (!form.doorType) {
    submitError.value = 'Выберите тип двери.'
    return false
  }
  const lengthNum = Number(form.length)
  const widthNum = Number(form.width)
  if (!Number.isFinite(lengthNum) || lengthNum <= 0) {
    submitError.value = 'Введите корректную длину (число больше 0).'
    return false
  }
  if (!Number.isFinite(widthNum) || widthNum <= 0) {
    submitError.value = 'Введите корректную ширину (число больше 0).'
    return false
  }
  if (form.priorities.length !== 2) {
    priorityError.value = 'Выберите ровно 2 приоритета.'
    return false
  }
  if (!form.phoneNumber?.trim()) {
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

  const measurements = `${form.length} x ${form.width}`

  const body = {
    fullName: form.fullName.trim(),
    doorType: form.doorType,
    measurements,
    length: Number(form.length),
    width: Number(form.width),
    dobor: form.dobor.trim() || '',
    phoneNumber: form.phoneNumber.trim(),
    priorities: [...form.priorities],
    language: form.language,
  }

  const url = `${API_BASE}/api/leads`
  console.log('Submitting to:', url)

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
      form.phoneNumber = ''
      form.doorType = ''
      form.length = null
      form.width = null
      form.dobor = ''
      form.priorities = []
    } else if (res.status === 400) {
      submitError.value = data.error || 'Проверьте данные и попробуйте снова.'
    } else {
      submitError.value = data.error || 'Ошибка сервера. Попробуйте позже.'
    }
  } catch (err) {
    console.error('Lead submit error:', err)
    submitError.value = 'Ошибка сети. Проверьте подключение и попробуйте снова.'
  } finally {
    loading.value = false
  }
}
</script>
