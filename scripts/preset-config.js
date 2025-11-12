/**
 * Runware Preset Configuration Form
 */

import { MODULE_ID, MODULE_NAME } from './constants.js';

export class RunwarePresetConfig extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(options = {}) {
    super(options);
    this.presets = null;
  }

  static DEFAULT_OPTIONS = {
    id: 'runware-preset-config',
    classes: ['runware-preset-config'],
    tag: 'form',
    window: {
      title: `${MODULE_NAME}: Preset Manager`,
      frame: true,
      positioned: true,
      minimizable: true
    },
    actions: {
      addPreset: RunwarePresetConfig.prototype._onAddPreset,
      removePreset: RunwarePresetConfig.prototype._onRemovePreset,
      addEmbedding: RunwarePresetConfig.prototype._onAddEmbedding,
      removeEmbedding: RunwarePresetConfig.prototype._onRemoveEmbedding,
      savePresets: RunwarePresetConfig.prototype._onSavePresets
    },
    form: {
      handler: RunwarePresetConfig.prototype._onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    },
    position: {
      width: 700,
      height: 'auto'
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/preset-config.hbs`
    }
  };

  async _prepareContext(options) {
    if (!Array.isArray(this.presets)) {
      this.presets = this._loadPresets();
    }

    return {
      presets: this.presets.map((preset) => this._clonePreset(preset))
    };
  }

  async _onAddPreset(event, target) {
    event?.preventDefault();
    this._addPreset();
  }

  async _onRemovePreset(event, target) {
    event?.preventDefault();
    const row = target.closest('.preset-row');
    if (!row) return;
    const presetId = row.dataset.presetId;
    this._removePreset(presetId);
  }

  async _onAddEmbedding(event, target) {
    event?.preventDefault();
    const row = target.closest('.preset-row');
    if (!row) return;
    const presetId = row.dataset.presetId;
    this._addEmbedding(presetId);
  }

  async _onRemoveEmbedding(event, target) {
    event?.preventDefault();
    const row = target.closest('.preset-row');
    const embedRow = target.closest('.embedding-row');
    if (!row || !embedRow) return;
    const presetId = row.dataset.presetId;
    const index = Number(embedRow.dataset.embeddingIndex ?? -1);
    this._removeEmbedding(presetId, index);
  }

  async _onSubmit(event, form, formData) {
    event?.preventDefault();
    event?.stopPropagation();
    await this._commitPresetChanges();
  }

  async _onSavePresets(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    await this._commitPresetChanges();
  }

  async _commitPresetChanges() {
    const form = this.form ?? this.element;
    if (!(form instanceof HTMLFormElement)) return;

    const rows = Array.from(form.querySelectorAll('.preset-row'));
    const presets = [];

    for (const row of rows) {
      const preset = this._readPresetRow(row);
      if (!preset) {
        return; // _readPresetRow handles notification on failure
      }
      presets.push(preset);
    }

    try {
      await game.settings.set(MODULE_ID, 'generationPresets', presets);
      this.presets = this._loadPresets();
      Hooks.callAll('runware-imagegen.presetsUpdated', this.presets);
      ui.notifications.info(`${MODULE_NAME}: Presets saved.`);
      await this.close();
    } catch (error) {
      console.error(`${MODULE_NAME} | Failed to save presets`, error);
      ui.notifications.error(`${MODULE_NAME}: Failed to save presets - ${error.message}`);
    }
  }

  _loadPresets() {
    const stored = game.settings.get(MODULE_ID, 'generationPresets') ?? [];
    if (!Array.isArray(stored)) return [];
    return stored.map((preset) => this._normalizePreset(preset));
  }

  _normalizePreset(preset = {}) {
    const normalized = {
      id: preset.id ?? foundry.utils.randomID(),
      name: preset.name ?? '',
      model: preset.model ?? '',
      lora: {
        model: preset.lora?.model ?? '',
        weight: this._coerceNumber(preset.lora?.weight, 1),
        trigger: preset.lora?.trigger ?? ''
      },
      vae: preset.vae ?? '',
      embeddings: Array.isArray(preset.embeddings)
        ? preset.embeddings.map((embed) => ({
            model: embed.model ?? '',
            weight: this._coerceNumber(embed.weight, 1)
          }))
        : []
    };

    return normalized;
  }

  _clonePreset(preset) {
    return {
      id: preset.id,
      name: preset.name,
      model: preset.model,
      lora: {
        model: preset.lora?.model ?? '',
        weight: preset.lora?.weight ?? 1,
        trigger: preset.lora?.trigger ?? ''
      },
      vae: preset.vae ?? '',
      embeddings: Array.isArray(preset.embeddings)
        ? preset.embeddings.map((embed, index) => ({
            model: embed.model,
            weight: embed.weight,
            index
          }))
        : []
    };
  }

  _coerceNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  _addPreset() {
    if (!Array.isArray(this.presets)) {
      this.presets = [];
    }

    this.presets.push(
      this._normalizePreset({
        name: 'New Preset',
        model: '',
        lora: { model: '', weight: 1, trigger: '' },
        vae: '',
        embeddings: []
      })
    );

    this.render(true);
  }

  _removePreset(presetId) {
    if (!presetId) return;
    this.presets = this.presets.filter((preset) => preset.id !== presetId);
    this.render(true);
  }

  _addEmbedding(presetId) {
    const preset = this.presets.find((p) => p.id === presetId);
    if (!preset) return;
    preset.embeddings.push({ model: '', weight: 1 });
    this.render(true);
  }

  _removeEmbedding(presetId, index) {
    const preset = this.presets.find((p) => p.id === presetId);
    if (!preset) return;
    if (index < 0 || index >= preset.embeddings.length) return;
    preset.embeddings.splice(index, 1);
    this.render(true);
  }

  _readPresetRow(row) {
    const presetId = row.dataset.presetId || foundry.utils.randomID();
    const nameInput = row.querySelector('input[name="preset-name"]');
    const modelInput = row.querySelector('input[name="preset-model"]');
    const loraModelInput = row.querySelector('input[name="preset-lora-model"]');
    const loraWeightInput = row.querySelector('input[name="preset-lora-weight"]');
    const loraTriggerInput = row.querySelector('input[name="preset-lora-trigger"]');
    const vaeInput = row.querySelector('input[name="preset-vae"]');

    const name = nameInput?.value.trim() ?? '';
    const model = modelInput?.value.trim() ?? '';

    if (!name) {
      ui.notifications.error(`${MODULE_NAME}: Preset name cannot be empty.`);
      return null;
    }

    if (!model) {
      ui.notifications.error(`${MODULE_NAME}: Preset "${name}" must specify a model.`);
      return null;
    }

    const preset = {
      id: presetId,
      name,
      model
    };

    const loraModel = loraModelInput?.value.trim() ?? '';
    const loraTrigger = loraTriggerInput?.value.trim() ?? '';
    if (loraModel) {
      preset.lora = {
        model: loraModel,
        weight: this._coerceNumber(loraWeightInput?.value, 1),
        trigger: loraTrigger
      };
    }

    const vae = vaeInput?.value.trim() ?? '';
    if (vae) {
      preset.vae = vae;
    }

    const embeddingRows = row.querySelectorAll('.embedding-row');
    const embeddings = [];

    embeddingRows.forEach((embedRow) => {
      const modelField = embedRow.querySelector('input[name="embedding-model"]');
      const weightField = embedRow.querySelector('input[name="embedding-weight"]');
      const embedModel = modelField?.value.trim() ?? '';
      if (!embedModel) return;
      embeddings.push({
        model: embedModel,
        weight: this._coerceNumber(weightField?.value, 1)
      });
    });

    if (embeddings.length > 0) {
      preset.embeddings = embeddings;
    }

    return preset;
  }
}
