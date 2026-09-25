/**
 * Image File Handler
 *
 * Utilities for saving generated images to the FoundryVTT data directory
 */

import { MODULE_NAME } from './constants.js';

export class ImageFileHandler {
  /**
   * Save a generated image to the Foundry data directory
   * @param {Actor} actor - The actor for which the image was generated
   * @param {Object} imageData - The image data from Runware
   * @returns {Promise<string>} The path to the saved image
   */
  static async saveImage(actor, imageData, options = {}) {
    try {
      const { type = 'avatar' } = options;

      // Get the base64 image data
      let base64Data = imageData.imageBase64Data;

      if (!base64Data) {
        throw new Error('No base64 image data provided');
      }

      // Create directory path: images/runware/<actor folder>/[tokens] at the Foundry data root
      const baseDirPath = `images/runware/${this.getActorFolderName(actor)}`;
      const dirPath = type === 'token' ? `${baseDirPath}/tokens` : baseDirPath;

      // Ensure the directory exists and list what's already in it
      const existingFiles = await this._ensureDirectory(dirPath);

      // Get the next image number for this actor and image type
      const filenamePrefix = type === 'token' ? 'token_' : 'image_';
      const imageNumber = this._getNextImageNumber(existingFiles, filenamePrefix);

      // Create filename
      const filename = `${filenamePrefix}${imageNumber}.png`;

      // Convert base64 to blob
      const blob = this._base64ToBlob(base64Data, 'image/png');

      // Upload the file using Foundry's FilePicker API
      const file = new File([blob], filename, { type: 'image/png' });

      // Upload to the data directory
      const filePicker = this._getFilePicker();
      const response = await filePicker.upload('data', dirPath, file, {}, { notify: false });

      if (response && response.path) {
        console.debug(`${MODULE_NAME} | Image saved to:`, response.path);
        return response.path;
      }

      throw new Error('Failed to upload image file');

    } catch (error) {
      console.error(`${MODULE_NAME} | Error saving image:`, error);
      throw error;
    }
  }

  /**
   * Folder name for an actor's images: a readable slug of the name plus the
   * actor id. The id keeps actors with colliding names ("Bob!" / "Bob?", every
   * "Goblin", or non-Latin names that slug to nothing) from sharing a folder
   * and overwriting each other's numbered files.
   * @param {Actor} actor
   * @returns {string}
   */
  static getActorFolderName(actor) {
    const slug = String(actor?.name ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // strip accents: "José" -> "jose"
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 48);
    const id = String(actor?.id ?? '').replace(/[^a-zA-Z0-9]/g, '');
    return [slug || 'actor', id].filter(Boolean).join('_');
  }

  /**
   * Ensure a directory exists, creating it if necessary.
   * @param {string} path - The directory path
   * @returns {Promise<string[]>} The files already in the directory (empty if it was just created).
   */
  static async _ensureDirectory(path) {
    const filePicker = this._getFilePicker();
    try {
      // Browse doubles as the existence check and as the file listing that
      // _getNextImageNumber() needs, so a save browses once instead of twice.
      const result = await filePicker.browse('data', path);
      return Array.isArray(result?.files) ? result.files : [];
    } catch {
      // Directory doesn't exist, create it
      console.debug(`${MODULE_NAME} | Creating directory:`, path);

      // We need to create directories one at a time
      const parts = path.split('/');
      let currentPath = '';

      for (const part of parts) {
        if (!part) continue;

        currentPath = currentPath ? `${currentPath}/${part}` : part;

        try {
          await filePicker.browse('data', currentPath);
        } catch {
          // This directory level doesn't exist, create it
          try {
            await filePicker.createDirectory('data', currentPath);
          } catch (createErr) {
            // Ignore error if directory was just created by another process.
            // createErr isn't guaranteed to be an Error with a `.message` (it
            // could be a string, a plain object, or undefined), so stringify
            // defensively before checking - otherwise a benign "already exists"
            // race can throw a TypeError here and abort saveImage() entirely.
            const createErrMessage = String(createErr?.message ?? createErr ?? '');
            if (!createErrMessage.includes('exists')) {
              console.warn(`${MODULE_NAME} | Could not create directory ${currentPath}:`, createErr);
            }
          }
        }
      }

      // Confirm the directory now exists and list it. This deliberately does
      // NOT swallow a failure: treating "couldn't browse" as "empty directory"
      // would restart numbering at 1 and overwrite an existing image_1.png.
      const result = await filePicker.browse('data', path);
      return Array.isArray(result?.files) ? result.files : [];
    }
  }

  /**
   * Get the next available image number from a directory listing.
   * @param {string[]} files - Paths returned by FilePicker.browse()
   * @param {string} filenamePrefix - `image_` or `token_`
   * @returns {number} The highest existing number + 1
   */
  static _getNextImageNumber(files, filenamePrefix = 'image_') {
    const escapedPrefix = filenamePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Anchored to the start of the filename so e.g. "old_image_99.png" doesn't count.
    const filenameRegex = new RegExp(`(?:^|/)${escapedPrefix}(\\d+)\\.png$`, 'i');

    const numbers = (files ?? [])
      .map((file) => {
        let name = file;
        try {
          name = decodeURIComponent(file);
        } catch {
          // Not URI-encoded - match the raw path.
        }
        const match = name.match(filenameRegex);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((num) => num > 0);

    return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  }

  /**
   * Convert base64 string to Blob
   * @param {string} base64 - The base64 string (optionally a data: URI)
   * @param {string} contentType - The content type (e.g., 'image/png')
   * @returns {Blob} The blob
   */
  static _base64ToBlob(base64, contentType = '') {
    const binary = atob(base64.replace(/^data:image\/\w+;base64,/, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: contentType });
  }

  static _getFilePicker() {
    const implementation = foundry?.applications?.apps?.FilePicker?.implementation;
    if (implementation) {
      return implementation;
    }

    if (globalThis.FilePicker) {
      return globalThis.FilePicker;
    }

    throw new Error(`${MODULE_NAME}: FilePicker API is unavailable.`);
  }
}
