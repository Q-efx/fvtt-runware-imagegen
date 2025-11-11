# Runware AI Image Generator for FoundryVTT

A FoundryVTT module that integrates [Runware AI](https://runware.ai) image generation directly into actor sheets. Generate high-quality AI images for your NPCs and player characters with ease!

## Features

- 🎨 **Easy Access**: Generate images directly from actor sheets with a button in the header bar (next to the prototype token button)
- 🤖 **Multiple AI Models**: Support for various AI models including Stable Diffusion, SDXL, and custom models from CivitAI
- 🎯 **Advanced Controls**:
  - Positive and negative prompts
  - Adjustable image dimensions (256x256 to 2048x2048)
  - LoRA model support for style adaptation
  - CFG Scale, inference steps, and seed control
  - Generate multiple images at once (1-4)
- 💾 **Organized Storage**: Images are automatically saved to `modules/runware-image-generator/images/actor-name/`
- 🖼️ **Quick Application**: Option to set generated images as actor portraits immediately
- 🔐 **Secure**: API keys stored securely in world settings

## Installation

### Automatic Installation (Recommended)
1. In FoundryVTT, go to **Add-on Modules**
2. Click **Install Module**
3. Search for "Runware AI Image Generator"
4. Click **Install**

### Manual Installation
1. Download the latest release from the [GitHub repository]
2. Extract the zip file into your FoundryVTT `Data/modules` directory
3. Restart FoundryVTT
4. Enable the module in your world's **Module Management** settings

## Configuration

### 1. Get a Runware API Key
1. Visit [Runware AI](https://runware.ai)
2. Sign up for an account
3. Navigate to your API settings
4. Generate an API key

### 2. Configure the Module
1. In FoundryVTT, go to **Settings** → **Configure Settings** → **Module Settings**
2. Find **Runware AI Image Generator**
3. Enter your API key in the **Runware API Key** field
4. Optionally configure default settings:
   - **Default Model**: The AI model to use by default (e.g., `runware:100@1`)
   - **Image Width**: Default width for generated images (512px recommended)
   - **Image Height**: Default height for generated images (512px recommended)
   - **Number of Results**: How many images to generate per request (1-4)

## Usage

### Basic Image Generation

1. **Open an Actor Sheet** for any NPC or Character
2. **Click the "Generate Image" button** (🎨 palette icon) in the top bar next to the prototype token button
3. **Enter a Prompt**: Describe the image you want to generate
   - Example: *"A wise elderly wizard with a long white beard, wearing blue robes, fantasy art style"*
4. **Select a Model**: Choose from the suggested models or enter a custom model ID
5. **Click "Generate Image"**
6. **Wait for Generation**: The module will display a loading indicator
7. **Review the Result**: A dialog will appear asking if you want to set it as the actor's portrait
8. **Confirm or Save**: The image is saved either way in `modules/runware-image-generator/images/[actor-name]/`

### Advanced Options

Click **Show Advanced Options** in the dialog to access:

#### LoRA Models
Add style-specific fine-tuning to your images:
- **LoRA Model**: Enter a LoRA model ID (e.g., `civitai:12345@67890`)
- **Weight**: Adjust the influence of the LoRA (0.0 - 2.0, default 1.0)

#### Generation Parameters
- **Inference Steps**: More steps = higher quality but slower (20-50 recommended)
- **CFG Scale**: How closely to follow the prompt (7.0 recommended)
- **Seed**: For reproducible results, enter a specific number

#### Image Dimensions
- Adjust width and height independently (256-2048px)
- Use multiples of 64 for best results
- Square images (512x512) typically work best

### Finding Models

#### Built-in Suggestions
The module includes quick-select buttons for popular models:
- **Stable Diffusion 1.5** (`runware:100@1`)
- **Stable Diffusion XL** (`runware:101@1`)
- **Realistic Vision** (`civitai:4201@130072`)
- **DreamShaper** (`civitai:4384@128713`)

#### Custom Models
You can use any model from:
- **Runware Models**: Format `runware:MODEL_ID@VERSION`
- **CivitAI Models**: Format `civitai:MODEL_ID@VERSION_ID`

Visit [CivitAI](https://civitai.com) to browse thousands of community models.

## File Organization

Generated images are saved in an organized directory structure:

```
Data/
  modules/
    runware-image-generator/
      images/
        warrior_character/
          image_1.png
          image_2.png
          image_3.png
        npc_shopkeeper/
          image_1.png
          image_2.png
```

- Actor names are sanitized (special characters replaced with underscores)
- Images are numbered sequentially
- Images persist across sessions
- You can access these files directly via the FilePicker

## Prompt Tips

### Good Prompts
- Be specific about appearance, style, and mood
- Include details like clothing, accessories, lighting
- Mention art style (e.g., "fantasy art", "realistic", "anime style")
- Use descriptive adjectives

**Example Good Prompt:**
```
A fierce female warrior with red hair in a ponytail, wearing silver plate armor
with gold trim, holding a flaming sword, dramatic lighting, fantasy art style,
detailed face, heroic pose
```

### Negative Prompts
Use negative prompts to avoid unwanted elements:
- Common exclusions: `blurry, low quality, deformed, ugly, text, watermark`
- Style exclusions: `cartoon, anime` (if you want realistic)
- Content exclusions: Specific unwanted objects or features

### Prompt Weight Syntax
You can emphasize parts of your prompt:
- Use parentheses: `(important detail:1.2)` increases weight
- Use brackets: `[less important detail:0.8]` decreases weight

## Troubleshooting

### "Please configure your Runware API key"
**Solution**: Go to Module Settings and enter your valid Runware API key.

### "Image generation failed"
**Possible causes**:
- Invalid API key
- Insufficient credits in your Runware account
- Invalid model ID
- Network connection issues

**Solutions**:
- Verify your API key is correct
- Check your Runware account balance
- Try a different model from the suggestions
- Check browser console for detailed error messages

### Images not saving
**Possible causes**:
- Insufficient permissions on the Data directory
- File path issues

**Solutions**:
- Ensure FoundryVTT has write permissions to the Data folder
- Check browser console for specific errors
- Try generating with a different actor name

### Button not appearing
**Possible causes**:
- Module not enabled
- Not viewing as actor owner
- Sheet template incompatibility

**Solutions**:
- Verify module is enabled in Module Management
- Check that you have OWNER permission on the actor
- Try with a different actor sheet type

## API Integration

This module uses the [Runware SDK](https://github.com/runware/sdk-js) to communicate with the Runware API. The SDK is loaded dynamically via CDN.

### Key Features Used
- **Text-to-Image Generation**: Primary image generation
- **Base64 Output**: Images are received as base64 for local saving
- **Multiple Models**: Support for Runware and CivitAI models
- **LoRA Support**: Style adaptation via LoRA models
- **Advanced Parameters**: CFG Scale, steps, seed control

## Credits

- **Runware AI**: [https://runware.ai](https://runware.ai) - AI image generation API
- **Runware SDK**: [https://github.com/runware/sdk-js](https://github.com/runware/sdk-js)
- **FoundryVTT**: [https://foundryvtt.com](https://foundryvtt.com)

## License

This module is released under the MIT License. See LICENSE file for details.

## Support

For issues, feature requests, or questions:
- **GitHub Issues**: [Repository Issues Page]
- **FoundryVTT Discord**: Look for the module support channel

## Changelog

### Version 1.0.0
- Initial release
- Basic text-to-image generation
- Actor sheet integration
- Multiple model support
- LoRA support
- Advanced parameter controls
- Automatic image saving and organization
- Quick portrait application

## Roadmap

Future planned features:
- Image-to-image generation
- Batch generation for multiple actors
- Image history browser
- Preset prompt templates
- Integration with token images
- Style library

---

**Enjoy creating amazing character art with AI! 🎨✨**
