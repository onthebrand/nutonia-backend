import cloudinary from '../config/cloudinary.js';

/**
 * Uploads a base64 image or URL to Cloudinary
 * @param source Base64 string or URL
 * @param folder Optional folder name (default: 'nutonia-content')
 * @returns Promise with the secure URL of the uploaded image
 */
export async function uploadImage(source: string, folder: string = 'nutonia-content'): Promise<string> {
    try {
        const result = await cloudinary.uploader.upload(source, {
            folder,
            resource_type: 'image',
        });
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary upload failed:', error);
        throw new Error('Failed to upload image to storage');
    }
}

/**
 * Uploads a video URL to Cloudinary
 * @param url Video URL
 * @param folder Optional folder name
 */
export async function uploadVideo(url: string, folder: string = 'nutonia-content'): Promise<string> {
    try {
        const result = await cloudinary.uploader.upload(url, {
            folder,
            resource_type: 'video',
        });
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary video upload failed:', error);
        throw new Error('Failed to upload video to storage');
    }
}

export default {
    uploadImage,
    uploadVideo,
};
