# Runware Image Generator Module - Technical Overview

## Module Architecture

This FoundryVTT module integrates Runware AI image generation directly into actor sheets. Here's how it all works together:

### Core Components

#### 1. Module Manifest (`module.json`)
- Defines module metadata and compatibility
- Specifies dependencies (scripts, styles, languages)
- Compatible with FoundryVTT v13+

#### 2. Main Module File (`scripts/module.js`)
- **Initialization**: Registers module settings during the `init` hook
- **Settings**: API key, default model, image dimensions, number of results
- **Hook Integration**: Adds button to actor sheets via `getActorSheetHeaderButtons`
- **Orchestration**: Coordinates between dialog, API, and file handler

#### 3. Image Generation Dialog (`scripts/dialog.js`)
- **FormApplication**: Extends FoundryVTT's FormApplication class
- **Runware SDK Integration**: Loads SDK dynamically from CDN
- **User Interface**: Provides form for prompts, models, and parameters
- **API Communication**: Handles image generation requests
- **State Management**: Manages loading states and prevents duplicate requests

#### 4. File Handler (`scripts/file-handler.js`)
- **Image Saving**: Converts base64 to Blob and uploads via FilePicker API
- **Directory Management**: Creates and manages actor-specific directories
- **File Numbering**: Auto-increments image numbers per actor
- **Utilities**: Base64 conversion and file organization

#### 5. Styles (`styles/module.css`)
- **Button Styling**: Makes the generate button match FoundryVTT's UI
- **Dialog Layout**: Responsive form layout with sections
- **Advanced Options**: Collapsible section with toggle animation
- **Loading States**: Visual feedback during generation

#### 6. Template (`templates/image-dialog.hbs`)
- **Handlebars Template**: Defines the dialog HTML structure
- **Form Fields**: All input fields for prompts, models, and parameters
- **Dynamic Elements**: Model suggestions, advanced options toggle
- **Accessibility**: Proper labels and hints for all inputs

## Data Flow

### 1. User Opens Actor Sheet
```
User opens actor sheet
    ↓
getActorSheetHeaderButtons hook fires
    ↓
Module adds "Generate Image" button
```

### 2. User Clicks Generate Button
```
User clicks button
    ↓
openImageGenerationDialog() called
    ↓
RunwareImageDialog instantiated
    ↓
Dialog renders with Handlebars template
```

### 3. User Submits Form
```
User fills form and clicks "Generate Image"
    ↓
_onGenerate() validates input
    ↓
_generateImage() called
    ↓
Runware SDK loaded (if not already)
    ↓
runware.requestImages() with parameters
    ↓
API returns base64 image data
```

### 4. Image Saved and Applied
```
Image data received
    ↓
handleGeneratedImage() called
    ↓
ImageFileHandler.saveImage() saves to disk
    ↓
Dialog confirms with user
    ↓
Actor.update() sets new portrait (if confirmed)
```

## Key Technologies

### FoundryVTT APIs Used
- **Hooks System**: `init`, `ready`, `getActorSheetHeaderButtons`
- **FormApplication**: Extended for the dialog
- **FilePicker API**: For directory creation and file uploads
- **Settings API**: For module configuration
- **Dialog API**: For confirmation dialogs
- **Notifications**: For user feedback

### Runware SDK
- **Dynamic Import**: Loaded from CDN via ES modules
- **Async Initialization**: `Runware.initialize()` with API key
- **Image Generation**: `runware.requestImages()` method
- **Parameters**: Supports prompts, models, LoRA, CFG, steps, seed, etc.
- **Output**: Base64 image data for local storage

### Web Standards
- **ES6 Modules**: Import/export syntax
- **Async/Await**: For asynchronous operations
- **FormData API**: For form data extraction
- **Blob API**: For image data conversion
- **File API**: For creating file objects

## Configuration Options

### Module Settings (World-Level)
```javascript
game.settings.register(MODULE_ID, 'apiKey', {...})        // Required
game.settings.register(MODULE_ID, 'defaultModel', {...})  // Optional
game.settings.register(MODULE_ID, 'imageWidth', {...})    // Optional
game.settings.register(MODULE_ID, 'imageHeight', {...})   // Optional
game.settings.register(MODULE_ID, 'numberResults', {...}) // Optional
```

### Generation Parameters
- **Required**: Positive prompt, model
- **Optional**: Negative prompt, dimensions, LoRA, steps, CFG, seed

### Supported Models
- **Runware Models**: `runware:MODEL_ID@VERSION`
- **CivitAI Models**: `civitai:MODEL_ID@VERSION_ID`
- **LoRA Models**: Added via `lora` parameter array

## File Structure

### Module Directory
```
runware-image-generator/
├── module.json              # Manifest
├── README.md               # User documentation
├── SETUP.md                # Installation guide
├── LICENSE                 # MIT License
├── package.json            # NPM metadata
├── .gitignore             # Git ignore rules
├── scripts/
│   ├── module.js          # Main module entry point
│   ├── dialog.js          # Image generation dialog
│   └── file-handler.js    # File operations
├── styles/
│   └── module.css         # Module styles
├── templates/
│   └── image-dialog.hbs   # Dialog template
├── lang/
│   └── en.json           # English translations
└── images/               # Generated images (auto-created)
    └── [actor-name]/
        └── image_N.png
```

## Security Considerations

1. **API Key Storage**: Stored in world settings (GM-only access)
2. **File Permissions**: Uses FoundryVTT's FilePicker API (respects user permissions)
3. **Input Validation**: Validates all form inputs before API calls
4. **Error Handling**: Catches and displays errors gracefully
5. **XSS Prevention**: Uses FoundryVTT's built-in template rendering

## Performance Optimizations

1. **Lazy Loading**: Runware SDK loaded only when needed
2. **Base64 Output**: Images received as base64 to avoid CORS issues
3. **Sequential Numbering**: Efficient file naming without conflicts
4. **Async Operations**: Non-blocking UI during generation
5. **State Management**: Prevents multiple simultaneous requests

## Extensibility

### Adding New Features
The module is designed to be extensible:

1. **New Parameters**: Add to dialog template and `_generateImage()`
2. **Custom Models**: Update model suggestions in `getData()`
3. **Batch Operations**: Extend to support multiple actors
4. **Image Variants**: Add image-to-image or editing features
5. **Presets**: Create preset prompt templates

### Hooks for Other Modules
Other modules could potentially hook into:
- File saving process
- Image generation completion
- Dialog rendering

## Testing Checklist

### Basic Functionality
- [ ] Module loads without errors
- [ ] Settings are saved correctly
- [ ] Button appears on actor sheets
- [ ] Dialog opens and renders properly
- [ ] Image generation works with default settings

### Advanced Features
- [ ] LoRA models apply correctly
- [ ] Advanced parameters (steps, CFG, seed) work
- [ ] Multiple images generate correctly
- [ ] Negative prompts are applied

### Error Handling
- [ ] Invalid API key shows error
- [ ] Missing prompt shows error
- [ ] Network errors are caught
- [ ] File save errors are handled

### Edge Cases
- [ ] Actor names with special characters
- [ ] Very long prompts
- [ ] Large image dimensions
- [ ] Rapid button clicks (duplicate prevention)

## Common Customizations

### Change Default Dimensions
Edit in `module.js`:
```javascript
game.settings.register(MODULE_ID, 'imageWidth', {
  default: 768, // Change from 512
});
```

### Add More Model Suggestions
Edit in `dialog.js`:
```javascript
modelSuggestions: [
  { value: 'your-model-id', label: 'Your Model Name' },
  // ... existing suggestions
]
```

### Modify Button Position
Edit the hook in `module.js`:
```javascript
buttons.unshift({...})  // Start of array
// or
buttons.push({...})     // End of array
```

### Custom Image Naming
Edit in `file-handler.js`:
```javascript
const filename = `custom_name_${imageNumber}.png`;
```

## Troubleshooting Development

### Module Not Loading
1. Check browser console for syntax errors
2. Verify `module.json` is valid JSON
3. Ensure all files are in correct locations
4. Check FoundryVTT version compatibility

### Dialog Not Rendering
1. Verify template file exists and is valid Handlebars
2. Check `getData()` returns correct object structure
3. Ensure CSS file is loaded

### API Calls Failing
1. Verify API key is valid and has credits
2. Check network tab in DevTools for API responses
3. Ensure Runware SDK loads correctly from CDN
4. Verify CORS is not blocking requests

### Images Not Saving
1. Check file permissions on Data directory
2. Verify FilePicker.upload() has correct parameters
3. Ensure directory creation succeeds
4. Check for disk space issues

## Future Enhancement Ideas

1. **Image History**: Browse previously generated images
2. **Batch Generation**: Generate for multiple actors at once
3. **Image Variants**: Generate variations of existing images
4. **Prompt Templates**: Save and reuse prompt templates
5. **Token Integration**: Apply to token images, not just portraits
6. **Image Editing**: Inpainting, upscaling, background removal
7. **Style Presets**: Predefined style configurations
8. **Gallery View**: Visual browser for all generated images
9. **Import/Export**: Share prompts and settings
10. **Automatic Prompts**: Generate prompts from actor stats/traits

## Resources

### FoundryVTT Development
- [FoundryVTT API Documentation](https://foundryvtt.com/api/v13/)
- [FoundryVTT Discord](https://discord.gg/foundryvtt)
- [Module Development Guide](https://foundryvtt.com/article/module-development/)

### Runware API
- [Runware Documentation](https://docs.runware.ai/)
- [Runware SDK GitHub](https://github.com/runware/sdk-js)
- [Runware Dashboard](https://runware.ai)

### Model Resources
- [CivitAI Model Browser](https://civitai.com)
- [Stable Diffusion Models](https://huggingface.co/models?pipeline_tag=text-to-image)

---

**Module Version**: 1.0.0  
**FoundryVTT Version**: v13+  
**Last Updated**: 2025
