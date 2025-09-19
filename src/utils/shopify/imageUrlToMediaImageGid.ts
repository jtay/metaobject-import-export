import { ShopifyGraphQLClient } from './client';

const FILE_CREATE_MUTATION = `
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      id
      fileStatus
      alt
      createdAt
      ... on MediaImage {
        id
        image {
          width
          height
        }
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

export interface ImageUploadResult {
	id: string | null;
	status: 'success' | 'error' | 'processing';
	error?: string;
	width?: number;
	height?: number;
}

export async function imageUrlToMediaImageGid(
	client: ShopifyGraphQLClient,
	imageUrl: string,
	alt?: string
): Promise<ImageUploadResult> {
	try {
		// Validate URL format
		try {
			new URL(imageUrl);
		} catch {
			return {
				id: null,
				status: 'error',
				error: 'Invalid image URL format'
			};
		}

		// Create file from external URL
		const response = await client.request<{
			fileCreate: {
				files: Array<{
					id: string;
					fileStatus: string;
					alt?: string;
					createdAt: string;
					image?: {
						width: number;
						height: number;
					};
				}>;
				userErrors: Array<{
					field?: string[];
					message: string;
					code?: string;
				}>;
			};
		}>(FILE_CREATE_MUTATION, {
			files: [
				{
					contentType: 'IMAGE',
					originalSource: imageUrl,
					alt: alt || 'Imported Metaobject Backreference Image',
					duplicateResolutionMode: 'APPEND_UUID'
				}
			]
		});

		// Check for GraphQL errors
		if (response.errors && response.errors.length > 0) {
			const errorMsg = response.errors.map(e => e.message).join('; ');
			return {
				id: null,
				status: 'error',
				error: `GraphQL errors: ${errorMsg}`
			};
		}

		// Check for user errors
		if (response.data?.fileCreate?.userErrors && response.data.fileCreate.userErrors.length > 0) {
			const errorMsg = response.data.fileCreate.userErrors.map(e => e.message).join('; ');
			return {
				id: null,
				status: 'error',
				error: `File creation errors: ${errorMsg}`
			};
		}

		// Check if files were created
		const files = response.data?.fileCreate?.files;
		if (!files || files.length === 0) {
			return {
				id: null,
				status: 'error',
				error: 'No files were created'
			};
		}

		const file = files[0];
		
		// Return result based on file status
		const result: ImageUploadResult = {
			id: file.id,
			status: file.fileStatus === 'READY' ? 'success' : 'processing'
		};

		// Add image dimensions if available
		if (file.image) {
			result.width = file.image.width;
			result.height = file.image.height;
		}

		return result;

	} catch (error) {
		return {
			id: null,
			status: 'error',
			error: error instanceof Error ? error.message : 'Unknown error occurred'
		};
	}
}
