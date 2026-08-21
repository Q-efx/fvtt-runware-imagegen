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

  async _onRender(context, options) {
    if (super._onRender) await super._onRender(context, options);
    // The template's inner <form> was removed to avoid nesting under the
    // AppV2 root <form> (see _commitPresetChanges/_syncPresetsFromForm); set
    // autocomplete="off" here instead since the root element can't take the
    // attribute from the template.
    this.element?.setAttribute('autocomplete', 'off');
  }

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
      // game.settings.set() triggers the setting's own onChange callback
      // (registered in module.js), which dispatches 'presetsUpdated' to every
      // open dialog. Dispatching it again here would fire the hook twice per
      // save, so this is the only place that call happens.
      await game.settings.set(MODULE_ID, 'generationPresets', presets);
      this.presets = this._loadPresets();
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
      width: this._coerceDimension(preset.width),
      height: this._coerceDimension(preset.height),
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
      width: Number.isFinite(preset.width) ? preset.width : '',
      height: Number.isFinite(preset.height) ? preset.height : '',
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
    this._syncPresetsFromForm();

    if (!Array.isArray(this.presets)) {
      this.presets = [];
    }

    this.presets.push(
      this._normalizePreset({
        name: 'New Preset',
        model: '',
        width: null,
        height: null,
        lora: { model: '', weight: 1, trigger: '' },
        vae: '',
        embeddings: []
      })
    );

    this.render(true);
  }

  _removePreset(presetId) {
    if (!presetId) return;
    this._syncPresetsFromForm();
    this.presets = this.presets.filter((preset) => preset.id !== presetId);
    this.render(true);
  }

  _addEmbedding(presetId) {
    this._syncPresetsFromForm();
    const preset = this.presets.find((p) => p.id === presetId);
    if (!preset) return;
    preset.embeddings.push({ model: '', weight: 1 });
    this.render(true);
  }

  _removeEmbedding(presetId, index) {
    this._syncPresetsFromForm();
    const preset = this.presets.find((p) => p.id === presetId);
    if (!preset) return;
    if (index < 0 || index >= preset.embeddings.length) return;
    preset.embeddings.splice(index, 1);
    this.render(true);
  }

  /**
   * Rebuild this.presets from the live form inputs, preserving each row's existing
   * preset id and every embedding row (including blank ones) at its current index.
   * Called before any mutation handler re-renders, so unsaved edits in other rows
   * survive the re-render instead of being discarded.
   */
  _syncPresetsFromForm() {
    const form = this.form ?? this.element;
    if (!(form instanceof HTMLFormElement)) return;

    const rows = Array.from(form.querySelectorAll('.preset-row'));
    this.presets = rows.map((row) => this._normalizePreset(this._extractPresetFields(row)));
  }

  /**
   * Read the raw, unvalidated field values out of a preset row. Shared by the
   * save-path validator (_readPresetRow) and the interim sync (_syncPresetsFromForm)
   * so the input selectors only live in one place. Blank values and blank
   * embedding rows are preserved as-is - callers decide whether/how to validate.
   */
  _extractPresetFields(row) {
    const nameInput = row.querySelector('input[name="preset-name"]');
    const modelInput = row.querySelector('input[name="preset-model"]');
    const widthInput = row.querySelector('input[name="preset-width"]');
    const heightInput = row.querySelector('input[name="preset-height"]');
    const loraModelInput = row.querySelector('input[name="preset-lora-model"]');
    const loraWeightInput = row.querySelector('input[name="preset-lora-weight"]');
    const loraTriggerInput = row.querySelector('input[name="preset-lora-trigger"]');
    const vaeInput = row.querySelector('input[name="preset-vae"]');

    const embeddings = Array.from(row.querySelectorAll('.embedding-row')).map((embedRow) => {
      const modelField = embedRow.querySelector('input[name="embedding-model"]');
      const weightField = embedRow.querySelector('input[name="embedding-weight"]');
      return {
        model: modelField?.value.trim() ?? '',
        weight: weightField?.value ?? 1
      };
    });

    return {
      id: row.dataset.presetId || null,
      name: nameInput?.value.trim() ?? '',
      model: modelInput?.value.trim() ?? '',
      width: widthInput?.value ?? '',
      height: heightInput?.value ?? '',
      lora: {
        model: loraModelInput?.value.trim() ?? '',
        weight: loraWeightInput?.value ?? 1,
        trigger: loraTriggerInput?.value.trim() ?? ''
      },
      vae: vaeInput?.value.trim() ?? '',
      embeddings
    };
  }

  _readPresetRow(row) {
    const fields = this._extractPresetFields(row);
    const presetId = fields.id || foundry.utils.randomID();

    if (!fields.name) {
      ui.notifications.error(`${MODULE_NAME}: Preset name cannot be empty.`);
      return null;
    }

    if (!fields.model) {
      ui.notifications.error(`${MODULE_NAME}: Preset "${fields.name}" must specify a model.`);
      return null;
    }

    const preset = {
      id: presetId,
      name: fields.name,
      model: fields.model
    };

    const width = this._coerceDimension(fields.width);
    if (width) {
      preset.width = width;
    }

    const height = this._coerceDimension(fields.height);
    if (height) {
      preset.height = height;
    }

    if (fields.lora.model) {
      preset.lora = {
        model: fields.lora.model,
        weight: this._coerceNumber(fields.lora.weight, 1),
        trigger: fields.lora.trigger
      };
    }

    if (fields.vae) {
      preset.vae = fields.vae;
    }

    const embeddings = fields.embeddings
      .filter((embed) => embed.model)
      .map((embed) => ({
        model: embed.model,
        weight: this._coerceNumber(embed.weight, 1)
      }));

    if (embeddings.length > 0) {
      preset.embeddings = embeddings;
    }

    return preset;
  }

  _coerceDimension(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(num);
  }
}
