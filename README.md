![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/Q-efx/fvtt-runware-imagegen?utm_source=oss&utm_medium=github&utm_campaign=Q-efx%2Ffvtt-runware-imagegen&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

# Runware AI Image Generator for FoundryVTT

A FoundryVTT module that integrates [Runware AI](https://runware.ai) image generation directly into actor sheets. Generate high-quality AI images for your NPCs and player characters with ease!

## Features

- 🎨 **Easy Access**: Generate images directly from actor sheets with a button in the header bar (next to the prototype token button)
- 🤖 **Multiple AI Models**: Support for various AI models including Stable Diffusion, SDXL, and custom models from CivitAI
- 🧰 **GM Presets**: Game Masters can curate shared presets (model, dimensions, steps, CFG scale, LoRA, VAE, embeddings) for players to apply instantly
- 💎 **Built-in Premium Presets**: eight ready-made 2:3 (1024x1536) presets for premium models - Qwen-Image 3.0, FLUX.2 pro and max, GPT Image, Seedream 5.0 Pro - that the GM switches on one by one
- 🎯 **Advanced Controls**:
  - Positive and negative prompts
  - Adjustable image dimensions (256x256 to 2048x2048)
  - LoRA model support for style adaptation
  - CFG Scale, inference steps, and seed control
  - Generate multiple images at once (1-4) with an in-app gallery to pick your favorite result
- 💾 **Organized Storage**: Portraits and token variants are automatically saved to `images/runware/<actor-name>_<actor-id>/` in the Foundry data directory (tokens live in the `/tokens` subfolder, generated backgrounds in `/backgrounds`); generated rings are shared by the whole world in `images/runware/rings/`
- 🖼️ **Use This Image**: After picking a result, choose separately what the portrait and the token should be, with a live preview - nothing is paid for or saved until you press Apply, unless you explicitly generate a ring or preview a background
- 🪄 **Token Ready**: The token always gets a background-free subject (Bria RMBG 2.0 by default), with:
  - No ring, Foundry's dynamic token ring (ring colour, background colour, subject scale), or a custom AI-generated ring baked into the token image
  - A transparent, solid-colour, or AI-generated background kept inside the ring
  - Drag and zoom the character inside the token, and paint the parts that should reach over the ring (a weapon arm, a wing) while the rest stays inside
  - Portraits can keep their background, have it removed, or get a newly generated one
- 🔐 **API key in world settings**: only the GM can change it, but every connected player can read it - see [SETUP.md](SETUP.md)

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
   - **Background Removal Model** and the **ring / background prompt templates** - see [SETUP.md](SETUP.md)

## Usage

### Basic Image Generation

1. **Open an Actor Sheet** for any NPC or Character
2. **Click the "Generate Image" button** (🎨 palette icon) in the top bar next to the prototype token button
3. **Enter a Prompt**: Describe the image you want to generate
   - Example: *"A wise elderly wizard with a long white beard, wearing blue robes, fantasy art style"*
4. **Select a Model**: Choose from the suggested models or enter a custom model ID
5. **Click "Generate Image"**
6. **Wait for Generation**: The module will display a loading indicator
7. **Review the Results**: If multiple images were requested, a gallery lets you preview and choose your favorite
8. **Use this image**: A window opens with a preview and two cards, **Set as portrait** and **Set as token** (see below). Untick either one to leave it unchanged
9. **Click Apply**: The button lists the paid calls it will make, e.g. *Apply (1 background removal, 1 background generation)*. The images are then built, saved, and applied to the actor. **Back to images** returns to the gallery; **Cancel** (or closing the window) saves nothing and keeps the generation dialog open with your prompt

### Portrait and Token Options

As soon as the window opens, the character's background is removed (paid: one background removal with the **Background Removal Model** setting, Bria RMBG 2.0 by default) whenever the token is set or the portrait background is removed or replaced, so both previews show the cut-out character. It happens once per image - Apply, **Back to images** and picking the same image again reuse it - and again later only if you switch to an option that needs it.

**Portrait - Background**
- **Keep original**: the image exactly as generated
- **Remove background**: preselected when **Remove Background** is ticked in the generation form
- **Generate new background**: the character is cut out and placed on a newly generated background (the prompt is prefilled and editable)

**Token** - the background is always removed from the token's character.
- **Ring**
  - **No ring**: just the transparent character
  - **Foundry dynamic ring** (only offered if your system has dynamic rings): set a ring colour, background colour, and subject scale. The ring *style* is a world-wide Foundry setting chosen by the GM
  - **Custom ring**: pick a ring that anyone in this world generated before, or choose **Generate new ring…**, edit the prompt, and click **Generate ring** (paid: one image plus one background removal; you can regenerate before applying). The ring is baked into the token image, and Foundry's dynamic ring is turned off for this token
- **Token background**: **Transparent** (called **Ring default** under a dynamic ring), **Solid colour** (dynamic ring only), or **Generate background**, which is clipped to a circle inside the ring. If the portrait also gets a new background, the token can reuse it for free
- **Keep the character inside the ring** (on by default, with a ring): cuts off whatever reaches past the ring. Untick it to let the character break out of the frame
- **Ring overlap** (with **Keep the character inside the ring**): click **Paint overlap** and paint over the parts of the character that should pass over the ring, e.g. the arm holding a weapon - everything else stays inside. The preview grows while you paint; use the brush, the eraser, the brush size slider, **Undo** (or Ctrl+Z) and **Clear**, then **Done painting** to move or zoom the character again. The painted area moves and zooms with the character, and it is free: it is only applied when the token image is built on Apply
- **Position and zoom**: drag the character in the token preview to move it, and use the mouse wheel to zoom (around the cursor). Double-click the preview or press the reset button to centre it again. The framing is baked into the token image on Apply

**Preview background**: under each background prompt, **Preview background** generates the background now so you can see it in the preview before applying (paid: one image, plus the character's background removal the first time - Apply needs that removal anyway). Apply reuses the previewed background instead of paying again. Click **Regenerate background** for another one. If you edit the prompt or the model afterwards, the old preview stays visible but dimmed and marked *outdated*, and Apply generates a new background; change it back and the preview is used again. Like a generated ring, a previewed background is only saved on Apply - **Back to images** keeps it, **Cancel** discards it.

**Model for rings & backgrounds** (top of the window): **Same as generation** uses the model and settings from the generation form; or pick one of the GM's presets, including the built-in presets the GM enabled (its model, LoRA, VAE, embeddings, steps and CFG scale). A preset's LoRA trigger word is not added to the ring and background prompts automatically - add it yourself if you want it. GMs can open the preset manager from the button next to the list; saved changes show up in an open window right away.

If Apply fails, press it again: results you already paid for are reused, also after **Back to images**.

> A GM's **Prototype Token Overrides** (core setting) can force ring settings per actor type and win over these choices.

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

#### Built-in Premium Presets
The GM can enable these in **Manage Presets** (all are off by default, because every image is billed to the GM's key). Each one sets the model and a 2:3 size of 1024x1536:

| Preset | Model | Approx. cost per image |
| --- | --- | --- |
| Premium Illustration (Qwen-Image 3.0) | `alibaba:qwen-image@3.0` | ~$0.03 |
| Premium Illustration+ (Qwen-Image 3.0 Pro) | `alibaba:qwen-image@3.0-pro` | ~$0.04-0.075 |
| Premium Painterly (FLUX.2 pro) | `bfl:5@1` | ~$0.04 |
| Premium Prompt-Following (GPT-Image-2.5 Flare) | `openai:gpt-image@2.5-flare` | ~$0.03-0.05 |
| Premium (GPT Image 2) | `openai:gpt-image@2` | ~$0.03-0.05 |
| Premium Detail (Seedream 5.0 Pro) | `bytedance:seedream@5.0-pro` | ~$0.05-0.10 |
| Showcase (FLUX.2 max) | `bfl:7@1` | ~$0.09 |
| Showcase (GPT-Image-2.5 Sunburst) | `openai:gpt-image@2.5-sunburst` | ~$0.06+ |

These models take no steps, CFG scale, LoRA, VAE or embeddings, and only the two Qwen models take a negative prompt. The module leaves those fields out of their requests (also for rings and backgrounds) and tells you when it dropped something you entered. GPT Image needs at least 655,360 pixels and Seedream 5.0 Pro at least 921,600, so keep their portraits at 1024x1536: the token background is a square of the portrait's shorter side.

Dark, bloody and horror characters are allowed as far as each model permits: FLUX.2 requests use the most permissive safety tolerance and GPT Image requests the `low` moderation level. Runware's own NSFW check is never switched on. Seedream and Qwen have no such setting, and every provider's own content policy still applies.

#### Custom Models
You can use any model from:
- **Runware Models**: Format `runware:MODEL_ID@VERSION`
- **CivitAI Models**: Format `civitai:MODEL_ID@VERSION_ID`

Visit [CivitAI](https://civitai.com) to browse thousands of community models.

## File Organization

Generated images are saved in an organized directory structure:

```
Data/
  images/
    runware/
      warrior_character/
        image_1.webp
        image_2.webp
        image_3.webp
        tokens/
          token_1.webp
        backgrounds/
          background_1.webp
      npc_shopkeeper/
        image_1.webp
        image_2.webp
        tokens/
          token_1.webp
      rings/
        ring_1.webp
```

- Everything is saved as WebP. Images saved as PNG by earlier versions stay where they are, and
  numbering continues after them.
- Actor names are sanitized (special characters replaced with underscores)
- Images are numbered sequentially
- Images persist across sessions
- Images are kept outside the module directory, so updating or uninstalling the module does not remove them
- You can access these files directly via the FilePicker
- Token images are stored alongside portraits under the `tokens/` subdirectory, and generated backgrounds under `backgrounds/` so they can be reused
- Generated rings go to the shared `rings/` folder, so every actor's **Custom ring** picker can offer them

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

### "Background removal failed"
**Solution**: The token and the "Remove / Generate new background" options need a working background-removal model. The window stays open so you can retry; check the **Background Removal Model** setting (clear it to restore the default `bria:2@1`) and your Runware balance.

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
- **Background Removal**: Bria RMBG 2.0 (`bria:2@1`) by default, configurable, for transparent tokens, custom rings, and new backgrounds

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

See [CHANGELOG.md](CHANGELOG.md) for the full, version-by-version history.

### Version 1.3.0
- Built-in premium presets: eight 2:3 presets for Qwen-Image 3.0 / 3.0 Pro, FLUX.2 pro and max, GPT Image 2 / 2.5 Flare / 2.5 Sunburst and Seedream 5.0 Pro, off until the GM enables them in Manage Presets
- Requests to these models leave out the fields they reject, and FLUX.2 and GPT Image use their most permissive content moderation so dark and gory characters aren't refused
- The "Use this image" window removes the character's background as soon as it opens, so both previews show the cut-out

### Version 1.2.0
- Ring overlap: paint the parts of the character that should reach over a dynamic or custom ring (a weapon arm, a wing) while the rest stays inside - brush, eraser, size, Undo and Clear, applied locally on Apply at no extra cost

### Version 1.1.0
- New "Use this image" window replaces the "Set as Actor Image?" prompt: configure portrait and token separately, with a preview, and see the paid calls before Apply
- Portraits can keep, remove, or replace their background with a generated one
- Tokens: Foundry dynamic ring (colours, subject scale), AI-generated custom rings shared across the world, and transparent, solid-colour or generated backgrounds
- Rings and backgrounds can be generated with any GM preset instead of the generation's own model
- Preview a generated background (portrait or token) before applying; Apply reuses it instead of paying again
- Background removal now uses Bria RMBG 2.0 (`bria:2@1`) - Runware shut down the old model - and is configurable, along with the ring and background prompt templates

### Version 1.0.1
- Fixed the release workflow: a release whose files didn't match its tag was published without `module.json`/`module.zip`, breaking installs and updates

### Version 1.0.0
- Fixed embeddings: standard model ids like `civitai:12345@67890` were sent as just `civitai`
- Image count, size, steps, CFG and seed are now validated and clamped before every paid request
- Images are saved only after you choose what to use them for, and nothing is lost if you cancel the picker - the dialog stays open with your prompt
- Each actor gets its own dialog and its own image folder (`<name>_<actor id>`), so actors with the same name no longer overwrite each other's images
- Token images now apply to unlinked tokens; locked compendium actors and missing file-browse permission are caught before the paid request
- One shared Runware connection instead of one per dialog, and the SDK is pinned to an exact version
- Hardened the release workflow; the Foundry package-registry publish step is no longer skipped

### Version 0.9.0
- Added automatic Runware API key validation when it's saved, and clear, actionable errors (instead of a silent minute-long hang) when generation or background removal hits an invalid key
- Fixed release packaging: previous release zips installed without templates or CSS, leaving both dialogs unable to render
- Fixed two data-loss bugs: the preset manager discarded unsaved edits, and a failed generation wiped your prompt
- The prototype token is no longer replaced without asking, and declining no longer costs a background-removal call
- Generation is blocked up front if you lack Foundry's "Upload New Files" permission, instead of failing after a paid request
- Replaced the last deprecated ApplicationV1 dialogs with DialogV2; removed the module's remaining jQuery
- Pinned the Runware SDK CDN import to major version 1 so an upstream release cannot break the module unannounced
- The advanced-options toggle is now keyboard accessible

### Version 0.8.1
- Verified compatibility with FoundryVTT V14 (build 14.367); no source changes were required

### Version 0.8.0
- Security updates to development dependencies (`js-yaml`, `ajv`, `brace-expansion`, `yaml`, `uuid`); no runtime behavior changes

### Version 0.7.0
- Added multi-result preview gallery so users can pick the best generation before saving
- Automatic background removal via Runware RMBG v2.0 with token images saved alongside portraits
- Enlarged image preview dialog for easier inspection of generated art
- Introduced GM-managed presets covering model, LoRA, VAE, and embeddings shared with players

### Version 0.1.0
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
- Style library

---

**Enjoy creating amazing character art with AI! 🎨✨**
