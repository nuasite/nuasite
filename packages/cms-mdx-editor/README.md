
Prose image previews resolve repository paths through the supplied media source;
the saved Markdown keeps the original public path. Adding a link with an empty
selection inserts a visible URL. Document edits reach `onChange` synchronously,
so hosts can save immediately after a formatting or insertion action. Mounting
or moving the selection does not normalize the stored text.
