# Setup and Installation Guide

## Quick Start

### Prerequisites
- FoundryVTT v13 or later
- A Runware API key (get one at [https://runware.ai](https://runware.ai))

### Installation Steps

1. **Install the Module**
   - Copy this entire directory to your FoundryVTT `Data/modules` folder
   - The directory should be named `runware-image-generator`
   - Final path should look like: `Data/modules/runware-image-generator/`

2. **Enable the Module**
   - Launch FoundryVTT
   - Open or create a World
   - Go to **Settings** → **Manage Modules**
   - Find "Runware AI Image Generator" and check the box
   - Click **Save Module Settings**

3. **Configure API Key**
   - Go to **Settings** → **Configure Settings**
   - Find the **Module Settings** tab
   - Look for "Runware AI Image Generator"
   - Enter your Runware API key
   - Click **Save Changes**

4. **Test the Module**
   - Open any Actor sheet (NPC or Character)
   - Look for the "Generate Image" button (palette icon 🎨) in the header
   - Click it to open the image generation dialog
   - Enter a prompt and generate your first image!

## Directory Structure

After installation, your module directory should look like this:

```
runware-image-generator/
├── module.json           # Module manifest
├── README.md            # Documentation
├── LICENSE              # MIT License
├── package.json         # Package metadata
├── .gitignore          # Git ignore rules
├── scripts/
│   ├── module.js       # Main module file
│   ├── dialog.js       # Image generation dialog
│   └── file-handler.js # File saving utilities
├── styles/
│   └── module.css      # Module styles
├── templates/
│   └── image-dialog.hbs # Dialog template
├── lang/
│   └── en.json         # English translations
└── images/             # Generated images (created automatically)
```

## Getting a Runware API Key

1. Visit [https://runware.ai](https://runware.ai)
2. Click "Sign Up" or "Get Started"
3. Create an account with your email
4. Navigate to your dashboard
5. Go to **API Keys** section
6. Click **Create New API Key**
7. Copy the API key
8. Paste it into the FoundryVTT module settings

## Module Settings

### Runware API Key
**Required** - Your API key from Runware.ai

### Default Model
**Optional** - Default: `runware:100@1`
- The AI model used by default
- Common options:
  - `runware:100@1` - Stable Diffusion 1.5
  - `runware:101@1` - Stable Diffusion XL
  - `civitai:4201@130072` - Realistic Vision
  - `civitai:4384@128713` - DreamShaper

### Image Width
**Optional** - Default: `512`
- Default width in pixels (256-2048)
- Use multiples of 64 for best results

### Image Height
**Optional** - Default: `512`
- Default height in pixels (256-2048)
- Use multiples of 64 for best results

### Number of Results
**Optional** - Default: `1`
- How many images to generate per request (1-4)
- More images = higher API cost

## Verifying Installation

### Check Module Files
Ensure all files are in the correct location:
- `modules/runware-image-generator/module.json` should exist
- `modules/runware-image-generator/scripts/module.js` should exist

### Check Browser Console
1. Open FoundryVTT
2. Press F12 to open Developer Tools
3. Go to the Console tab
4. Look for messages like:
   ```
   Runware AI Image Generator | Initializing module
   Runware AI Image Generator | Module initialized
   Runware AI Image Generator | Module ready
   ```

### Check for Warnings
If you see: `Runware AI Image Generator: Please configure your Runware API key`
- This is normal on first install
- Go to Module Settings and add your API key

## Troubleshooting Installation

### Module Not Appearing in Module List
**Cause**: Module files not in correct location
**Solution**: Ensure the directory is named exactly `runware-image-generator` and is directly under `Data/modules/`

### Module Enabled but Button Not Showing
**Causes**:
1. Actor sheet type incompatibility
2. Insufficient permissions
3. Module JavaScript errors

**Solutions**:
1. Try with a default system actor sheet
2. Ensure you have OWNER permission on the actor
3. Check browser console (F12) for errors

### "Failed to Load Module" Error
**Cause**: Syntax error in module files or missing dependencies
**Solution**: 
1. Re-download and reinstall the module
2. Check browser console for specific error messages
3. Ensure FoundryVTT is v13 or later

### API Key Not Saving
**Cause**: Permission issues or browser extensions
**Solution**:
1. Disable browser extensions (especially ad blockers)
2. Clear browser cache
3. Try a different browser
4. Check file permissions on Data directory

## Development Setup

If you want to modify or develop this module:

1. **Clone or Download** the repository
2. **Symlink** to your FoundryVTT modules folder:
   ```bash
   # On Linux/Mac
   ln -s /path/to/runware-image-generator /path/to/FoundryData/modules/
   
   # On Windows (as Administrator)
   mklink /D "C:\FoundryData\modules\runware-image-generator" "C:\path\to\runware-image-generator"
   ```
3. **Make Changes** to the source files
4. **Reload** FoundryVTT (or refresh browser) to test changes

### File Watching
For development, you may want to:
- Use browser DevTools for live JavaScript debugging
- Edit CSS and see changes by refreshing the dialog
- Test in a dedicated development world

## Uninstallation

To remove the module:

1. **Disable** the module in Module Management
2. **Delete** the module directory:
   - Remove `Data/modules/runware-image-generator/`
3. **Clean up images** (optional):
   - Generated images remain in the module directory
   - Delete the entire folder if you want to remove all generated images

## Support

If you encounter issues:

1. **Check the README**: Most common questions are answered there
2. **Browser Console**: Press F12 and check for error messages
3. **FoundryVTT Version**: Ensure you're on v13 or later
4. **API Key**: Verify your Runware API key is valid and has credits

For bugs or feature requests:
- Open an issue on GitHub
- Include: FoundryVTT version, browser, error messages, steps to reproduce

---

**Happy Image Generating! 🎨**
