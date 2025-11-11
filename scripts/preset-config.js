/**
 * Runware Preset Configuration Form
 */

import { MODULE_ID, MODULE_NAME } from './constants.js';

export class RunwarePresetConfig extends FormApplication {
  constructor(object = {}, options = {}) {
    super(object, options);
    this.presets = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'runware-preset-config',
      classes: ['runware-preset-config'],
      title: `${MODULE_NAME}: Preset Manager`,
      template: `modules/${MODULE_ID}/templates/preset-config.hbs`,
      width: 700,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false
    });
  }

  async getData(options = {}) {
    if (!Array.isArray(this.presets)) {
      this.presets = this._loadPresets();
    }

    return {
      presets: this.presets.map((preset) => this._clonePreset(preset))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('.add-preset').on('click', (event) => {
      event.preventDefault();
      this._addPreset();
    });

    html.find('.preset-list').on('click', '.remove-preset', (event) => {
      event.preventDefault();
      const row = event.currentTarget.closest('.preset-row');
      if (!row) return;
      const presetId = row.dataset.presetId;
      this._removePreset(presetId);
    });

    html.find('.preset-list').on('click', '.add-embedding', (event) => {
      event.preventDefault();
      const row = event.currentTarget.closest('.preset-row');
      if (!row) return;
      const presetId = row.dataset.presetId;
      this._addEmbedding(presetId);
    });

    html.find('.preset-list').on('click', '.remove-embedding', (event) => {
      event.preventDefault();
      const row = event.currentTarget.closest('.preset-row');
      const embedRow = event.currentTarget.closest('.embedding-row');
      if (!row || !embedRow) return;
      const presetId = row.dataset.presetId;
      const index = Number(embedRow.dataset.embeddingIndex ?? -1);
      this._removeEmbedding(presetId, index);
    });
  }

  async _updateObject(event, formData) {
    const root = this.element[0];
    if (!root) return;

    const rows = Array.from(root.querySelectorAll('.preset-row'));
    const presets = [];

    for (const row of rows) {
      const preset = this._readPresetRow(row);
      if (!preset) {
        return; // _readPresetRow handles notification on failure
      }
      presets.push(preset);
    }

    await game.settings.set(MODULE_ID, 'generationPresets', presets);
    this.presets = this._loadPresets();
    ui.notifications.info(`${MODULE_NAME}: Presets saved.`);
    this.render(false);
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
        weight: this._coerceNumber(preset.lora?.weight, 1)
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
        weight: preset.lora?.weight ?? 1
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
        lora: { model: '', weight: 1 },
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
    if (loraModel) {
      preset.lora = {
        model: loraModel,
        weight: this._coerceNumber(loraWeightInput?.value, 1)
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
