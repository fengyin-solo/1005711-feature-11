<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-label="登记校验记录">
      <header class="modal-head">
        <h3>登记校验记录</h3>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <div class="modal-body">
        <div class="form-grid">
          <label class="form-item">
            <span>装置编号 *</span>
            <select v-model="form.装置编号" @change="syncDeviceName">
              <option value="">请选择保护装置</option>
              <option v-for="device in devices" :key="String(device.id)" :value="String(device['装置编号'])">
                {{ device['装置编号'] }}（{{ device['所属间隔'] }}）
              </option>
            </select>
            <small v-if="deviceError" class="field-error">{{ deviceError }}</small>
          </label>
          <label class="form-item">
            <span>装置名称</span>
            <input v-model="form.装置名称" placeholder="随装置编号自动带出，可改" />
          </label>
          <label class="form-item">
            <span>校验项目 *</span>
            <select v-model="form.校验项目">
              <option value="">请选择校验项目</option>
              <option v-for="spec in RELAY_SPEC_ITEMS" :key="spec" :value="spec">{{ spec }}</option>
            </select>
            <small v-if="validation.itemError" class="field-error">{{ validation.itemError }}</small>
          </label>
          <label class="form-item">
            <span>动作值（{{ activeSpec ? activeSpec.unit : '' }}）</span>
            <input v-model="form.动作值" placeholder="如 6.00A，暂缺可留空" />
            <small v-if="validation.actionError" class="field-error">{{ validation.actionError }}</small>
            <small v-else-if="hintRange.action" class="field-hint">技术要求：{{ hintRange.action }}</small>
          </label>
          <label class="form-item">
            <span>返回值（{{ activeSpec ? activeSpec.unit : '' }}）</span>
            <input v-model="form.返回值" placeholder="如 5.10A，暂缺可留空" />
            <small v-if="validation.retractError" class="field-error">{{ validation.retractError }}</small>
            <small v-else-if="hintRange.retract" class="field-hint">技术要求：{{ hintRange.retract }}</small>
          </label>
          <label class="form-item">
            <span>校验人</span>
            <input v-model="form.校验人" placeholder="校验人姓名" />
          </label>
          <label class="form-item">
            <span>校验日期</span>
            <input v-model="form.校验日期" type="date" />
          </label>
        </div>

        <p v-if="validation.gaps.length" class="gap-tip">
          {{ validation.gaps.join('、') }}暂缺：记录照常登记，列表会标出缺在哪一格，补齐前该条不能导出、不能判定。
        </p>
        <p v-if="formMessage" class="form-message" :class="{ error: !formOk, ok: formOk }">
          {{ formMessage }}
        </p>
      </div>

      <footer class="modal-foot">
        <button class="btn primary" type="button" :disabled="submitting" @click="submit">
          {{ submitting ? '提交中…' : '提交校验记录' }}
        </button>
        <button class="btn ghost" type="button" :disabled="submitting" @click="emit('close')">
          取消
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { listRows } from '@/data/local-store'
import {
  findRelaySpec,
  rangeText,
  RELAY_SPEC_ITEMS,
} from '@/data/relay-spec'
import {
  DEVICE_KEY,
  saveRelayEntry,
  validateRelayDraft,
  type RelayDraft,
} from '@/data/relay-service'
import type { EntryRow } from '@/data/types'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const devices = listRows(DEVICE_KEY)

function emptyForm(): RelayDraft {
  return {
    装置编号: '',
    装置名称: '',
    校验项目: '',
    动作值: '',
    返回值: '',
    校验人: '',
    校验日期: new Date().toISOString().slice(0, 10),
  }
}

const form = reactive<RelayDraft>(emptyForm())
const submitting = ref(false)
const deviceError = ref('')
const formMessage = ref('')
const formOk = ref(false)

const activeSpec = computed(() =>
  form.校验项目 ? findRelaySpec(form.校验项目) : undefined,
)

const hintRange = computed(() => {
  const spec = activeSpec.value
  if (!spec) {
    return { action: '', retract: '' }
  }
  return {
    action: rangeText(spec.action, spec.unit),
    retract: rangeText(spec.retract, spec.unit),
  }
})

const validation = computed(() => validateRelayDraft(form))

function syncDeviceName() {
  const device = devices.find((item: EntryRow) => String(item['装置编号']) === form.装置编号)
  if (device) {
    form.装置名称 = String(device['所属间隔'] ?? '')
  }
}

function submit() {
  formMessage.value = ''
  formOk.value = false
  deviceError.value = form.装置编号.trim() === '' ? '请选择装置编号' : ''
  if (deviceError.value) {
    return
  }
  // 超技术要求 / 非数值在这里挡回，缺项不挡（由 validateRelayDraft 区分 gaps 与 error）。
  if (!validation.value.ok) {
    formMessage.value = validation.value.message
    return
  }
  submitting.value = true
  try {
    const outcome = saveRelayEntry({ ...form })
    formOk.value = outcome.ok
    formMessage.value = outcome.message
    if (outcome.ok) {
      emit('saved')
    }
  } finally {
    submitting.value = false
  }
}
</script>
