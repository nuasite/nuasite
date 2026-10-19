/** Passthrough `<video>` props accepted by the Astro component. */
interface BaseProps extends Omit<astroHTML.JSX.VideoHTMLAttributes, 'src'> {}

export interface VideoProps extends BaseProps {
	/** The video URL — an `n.video()` field value, used verbatim. */
	src: string
}
