/**
 * Image File Handler
 *
 * Utilities for saving generated images to the FoundryVTT data directory
 */

import { MODULE_ID, MODULE_NAME } from './module.js';

export class ImageFileHandler {
  /**
   * Save a generated image to the module directory
   * @param {Actor} actor - The actor for which the image was generated
   * @param {Object} imageData - The image data from Runware
   * @returns {Promise<string>} The path to the saved image
   */
  static async saveImage(actor, imageData) {
    try {
      // Get the base64 image data
      let base64Data = imageData.imageBase64Data;

      if (!base64Data) {
        throw new Error('No base64 image data provided');
      }

      // Create a clean actor name for the directory
      const actorNameClean = actor.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

      // Create directory path: modules/runware-image-generator/images/actor-name/
      const dirPath = `modules/${MODULE_ID}/images/${actorNameClean}`;

      // Ensure directory exists
      await this._ensureDirectory(dirPath);

      // Get the next image number for this actor
      const imageNumber = await this._getNextImageNumber(dirPath);

      // Create filename
      const filename = `image_${imageNumber}.png`;
      const fullPath = `${dirPath}/${filename}`;

      // Convert base64 to blob
      const blob = this._base64ToBlob(base64Data, 'image/png');

      // Upload the file using Foundry's FilePicker API
      const file = new File([blob], filename, { type: 'image/png' });

      // Upload to the data directory
      const response = await FilePicker.upload('data', dirPath, file, {}, { notify: false });

      if (response && response.path) {
        console.log(`${MODULE_NAME} | Image saved to:`, response.path);
        return response.path;
      }

      throw new Error('Failed to upload image file');

    } catch (error) {
      console.error(`${MODULE_NAME} | Error saving image:`, error);
      throw error;
    }
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param {string} path - The directory path
   * @returns {Promise<void>}
   */
  static async _ensureDirectory(path) {
    try {
      // Try to browse the directory to see if it exists
      await FilePicker.browse('data', path);
    } catch (error) {
      // Directory doesn't exist, create it
      console.log(`${MODULE_NAME} | Creating directory:`, path);

      // We need to create directories one at a time
      const parts = path.split('/');
      let currentPath = '';

      for (const part of parts) {
        if (!part) continue;

        currentPath = currentPath ? `${currentPath}/${part}` : part;

        try {
          await FilePicker.browse('data', currentPath);
        } catch (err) {
          // This directory level doesn't exist, create it
          try {
            await FilePicker.createDirectory('data', currentPath);
          } catch (createErr) {
            // Ignore error if directory was just created by another process
            if (!createErr.message.includes('exists')) {
              console.warn(`${MODULE_NAME} | Could not create directory ${currentPath}:`, createErr);
            }
          }
        }
      }
    }
  }

  /**
   * Get the next available image number for an actor
   * @param {string} dirPath - The directory path
   * @returns {Promise<number>} The next image number
   */
  static async _getNextImageNumber(dirPath) {
    try {
      // Browse the directory to get existing files
      const result = await FilePicker.browse('data', dirPath);

      if (!result || !result.files) {
        return 1;
      }

      // Find all image files and extract numbers
      const numbers = result.files
        .map(file => {
          const match = file.match(/image_(\d+)\.png$/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(num => num > 0);

      if (numbers.length === 0) {
        return 1;
      }

      // Return the highest number + 1
      return Math.max(...numbers) + 1;

    } catch (error) {
      // Directory doesn't exist or is empty
      return 1;
    }
  }

  /**
   * Convert base64 string to Blob
   * @param {string} base64 - The base64 string
   * @param {string} contentType - The content type (e.g., 'image/png')
   * @returns {Blob} The blob
   */
  static _base64ToBlob(base64, contentType = '') {
    // Remove data URI prefix if present
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');

    // Decode base64
    const byteCharacters = atob(base64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);

      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
  }

  /**
   * Get all images for a specific actor
   * @param {Actor} actor - The actor
   * @returns {Promise<Array<string>>} Array of image paths
   */
  static async getActorImages(actor) {
    try {
      const actorNameClean = actor.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const dirPath = `modules/${MODULE_ID}/images/${actorNameClean}`;

      const result = await FilePicker.browse('data', dirPath);

      if (!result || !result.files) {
        return [];
      }

      // Filter for PNG images and sort by number
      return result.files
        .filter(file => file.endsWith('.png'))
        .sort((a, b) => {
          const numA = parseInt(a.match(/image_(\d+)\.png$/)?.[1] || '0');
          const numB = parseInt(b.match(/image_(\d+)\.png$/)?.[1] || '0');
          return numA - numB;
        });

    } catch (error) {
      console.warn(`${MODULE_NAME} | No images found for actor:`, actor.name);
      return [];
    }
  }
}
