/**
	* Base properties for form components containing optional message strings
	*/
export interface BaseProps {
	/** Message to display when form submission is successful */
	successMessage?: string;
	/** Message to display when form submission encounters an error */
	errorMessage?: string;
	/** Message to display while form is being submitted */
	submittingMessage?: string;
	/** Message to display when a network error occurs */
	networkErrorMessage?: string;
	/** Message to display for retry prompt */
	tryAgainMessage?: string;
}

/**
	* Form properties that extend BaseProps and require either a formId or action (or both)
	*/
export type FormProps = BaseProps & (
	| { formId: string; action?: string }
	| { formId?: string; action: string }
);
