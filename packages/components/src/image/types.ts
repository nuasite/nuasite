/** Passthrough `<img>` props accepted by the Astro component. */
interface BaseProps extends astroHTML.JSX.ImgHTMLAttributes {}

type CloudflareImageFormat = 'auto' | 'webp' | 'avif' | 'jpeg' | 'baseline-jpeg' | 'json'
type CloudflareImageQuality =
	| number
	| 'high'
	| 'medium-high'
	| 'medium-low'
	| 'low'
type CloudflareImageFit = 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad' | 'squeeze'
type CloudflareImageGravity =
	| 'auto'
	| 'face'
	| 'left'
	| 'right'
	| 'top'
	| 'bottom'
	| `${number}x${number}`

/** Options mapped to Cloudflare Image Transform `/cdn-cgi/image/<options>/<src>` parameters. */
export type CloudflareImageTransformOptions = {
	/** Preserve animation frames (set false to flatten GIFs). */
	anim?: boolean
	/** Background color used for transparent images or fit=pad. */
	background?: string
	/** Blur radius 1-250. */
	blur?: number
	/** Border CSS color and widths (comma-joined string). */
	border?: string
	/** Brightness multiplier, 0.5-2.0. */
	brightness?: number
	/** Compression strategy override. */
	compression?: 'fast'
	/** Contrast multiplier, 0.5-2.0. */
	contrast?: number
	/** Device pixel ratio multiplier. */
	dpr?: number
	/** Resize fit mode. */
	fit?: CloudflareImageFit
	/** Flip image horizontally/vertically. */
	flip?: 'h' | 'v' | 'hv'
	/** Output format; defaults to auto negotiation. */
	format?: CloudflareImageFormat
	/** Exposure adjustment. */
	gamma?: number
	/** Crop focal point (auto, face, sides, or coordinates). */
	gravity?: CloudflareImageGravity
	/** Target height. */
	height?: number
	/** Metadata preservation strategy. */
	metadata?: 'copyright' | 'keep' | 'none'
	/** Redirect to origin on fatal resize error. */
	onError?: 'redirect'
	/** Quality scalar or perceptual presets. */
	quality?: CloudflareImageQuality
	/** Rotate degrees. */
	rotate?: 90 | 180 | 270
	/** Saturation multiplier (0 = grayscale). */
	saturation?: number
	/** Background segmentation toggle. */
	segment?: 'foreground'
	/** Sharpen strength 0-10. */
	sharpen?: number
	/** Override quality for slow connections. */
	slowConnectionQuality?: CloudflareImageQuality
	/** Trim pixels or border detection. */
	trim?: 'border' | string | number
	/** Trim border color (CSS syntax). */
	trimBorderColor?: string
	/** Trim border tolerance (0-255). */
	trimBorderTolerance?: number
	/** Pixels of original border to keep. */
	trimBorderKeep?: number
	/** Trim rectangle width. */
	trimWidth?: number
	/** Trim rectangle height. */
	trimHeight?: number
	/** Trim offset from left. */
	trimLeft?: number
	/** Trim offset from top. */
	trimTop?: number
	/** Target width or auto width negotiation. */
	width?: number | 'auto'
	/** Face zoom when gravity=face. */
	zoom?: number
}

/** Props for the responsive Cloudflare image component. */
export type ImageProps = BaseProps & {
	/** Width breakpoints used to build `srcset` (defaults applied). */
	widths?: number[]
	/** `sizes` attribute string. */
	sizes?: string
	/** Default quality applied to all generated URLs. */
	quality?: CloudflareImageQuality
	/** Default format applied to all generated URLs. */
	format?: CloudflareImageFormat
	/** Additional Cloudflare transform params applied to every variant. */
	transformOptions?: CloudflareImageTransformOptions
	/** Prefix for transform delivery path, defaults to `/cdn-cgi/image`. */
	deliveryBase?: string
}
