# Quick Start Guide

## For Users

### Installation (3 Steps)
1. Copy this folder to `FoundryVTT/Data/modules/`
2. Enable "Runware AI Image Generator" in Module Management
3. Add your Runware API key in Module Settings

### First Use (4 Steps)
1. Open any Actor sheet
2. Click the 🎨 "Generate Image" button
3. Enter a prompt (e.g., "a brave knight in shining armor")
4. Click "Generate Image" and wait

**That's it!** The image will be saved and you can set it as the actor's portrait.

---

## For Developers

### Module Entry Point
Start reading here: `scripts/module.js`

### Key Files
- `scripts/module.js` - Initialization, hooks, settings, post-generation flow
- `scripts/dialog.js` - Form dialog for image generation
- `scripts/preset-config.js` - GM-only preset manager
- `scripts/file-handler.js` - File operations
- `templates/image-dialog.hbs` - Dialog HTML template
- `templates/preset-config.hbs` - Preset manager template
- `styles/module.css` - Styling

### How It Works
```
User clicks button → Dialog opens → Form submitted →
Runware API called → Image(s) received → User picks one (if >1) →
Optional background removal → File saved →
User chooses portrait / token / both / neither → Actor updated
```

### Testing Locally
1. Symlink to your modules folder
2. Enable in FoundryVTT
3. Check browser console for logs
4. Test on a character sheet

### Key APIs Used
- FoundryVTT: `ApplicationV2`, `DialogV2`, `FilePicker`, `Hooks`, `Settings`
- Runware: Loaded from `https://cdn.jsdelivr.net/npm/@runware/sdk-js@1/+esm`
  (pinned to major v1; `@latest` risked an upstream release breaking the module)
- Web: `FormData`, `Blob`, `File`, ES6 modules

### Customization Points
- Model suggestions: `dialog.js` → `getData()`
- Button position: `module.js` → `getActorSheetHeaderButtons` hook
- Image naming: `file-handler.js` → `saveImage()`
- Default settings: `module.js` → `init` hook

### Common Tasks

**Add a new model suggestion:**
```javascript
// In dialog.js, getData() method
modelSuggestions: [
  { value: 'your-model-id', label: 'Display Name' },
  // ... existing
]
```

**Change default image size:**
```javascript
// In module.js, init hook
game.settings.register(MODULE_ID, 'imageWidth', {
  default: 768, // Change this
});
```

**Add a new parameter:**
1. Add field to `templates/image-dialog.hbs`
2. Read it in `dialog.js` → `_generateImage()`
3. Add to `requestParams` object

### Debugging
- Browser console (F12): All logs prefixed with module name
- Network tab: Check Runware API calls
- FoundryVTT console: Server-side file operations

### Need Help?
- Read: `TECHNICAL.md` for architecture details
- Read: `README.md` for user documentation
- Read: `SETUP.md` for installation details

---

## API Key Setup

### Get Your Key
1. Visit https://runware.ai
2. Sign up for an account
3. Go to API section
4. Generate a new API key
5. Copy it

### Add to FoundryVTT
1. Settings → Configure Settings
2. Module Settings tab
3. Find "Runware AI Image Generator"
4. Paste your API key
5. Save

---

## Example Prompts

### Good Prompts
```
"A wise elderly wizard with long white beard, blue robes, holding a staff,
fantasy art style, detailed face, magical atmosphere"

"Female rogue in leather armor, hooded cloak, daggers on belt,
standing in shadows, fantasy character art"

"Muscular dwarf warrior with red braided beard, plate armor,
battle axe, determined expression, D&D character portrait"
```

### Common Models
- `runware:100@1` - Stable Diffusion 1.5 (fast, versatile)
- `runware:101@1` - Stable Diffusion XL (high quality)
- `civitai:4201@130072` - Realistic Vision (photorealistic)
- `civitai:4384@128713` - DreamShaper (artistic)

---

## File Structure at a Glance

```
runware-image-generator/
├── 📄 module.json          # Manifest
├── 📘 README.md           # User docs
├── 🔧 TECHNICAL.md        # Dev docs
├── ⚙️  SETUP.md            # Install guide
├── 📜 LICENSE             # MIT
├── scripts/
│   ├── module.js          # Entry point ⭐
│   ├── dialog.js          # Dialog UI ⭐
│   ├── preset-config.js   # Preset manager
│   ├── file-handler.js    # File ops ⭐
│   └── constants.js       # Module id/name
├── templates/
│   ├── image-dialog.hbs   # Template ⭐
│   └── preset-config.hbs  # Preset template
├── styles/
│   └── module.css         # Styles
├── lang/
│   └── en.json           # i18n
└── images/               # Generated images
```

⭐ = Most important files to understand

---

## Quick Tips

### Performance
- Use 512x512 for fastest generation
- SDXL models are slower but higher quality
- More steps = better quality but slower

### Cost
- Each generation costs Runware credits
- Check your balance at https://runware.ai
- Smaller images = lower cost

### Quality
- Be specific in prompts
- Use negative prompts to avoid unwanted elements
- Experiment with different models
- Use LoRA for specific art styles

### Organization
- Images auto-save to actor-specific folders
- Names are numbered sequentially
- You can delete old images anytime

---

**Ready to go!** Open an actor sheet and click the 🎨 button.
