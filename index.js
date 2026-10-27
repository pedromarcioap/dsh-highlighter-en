/* dsh-highlighter — Node half (host-side placeholder plugin)
 *
 * All features are implemented on the browser side. The host-side loader requires a live fiber
 * so that client-modules scans this entry's dsh.client bundle into the boot graph;
 * therefore, an empty plugin registering nothing is provided here to ensure the entry activates normally.
 */
export default {
	apply(ctx) {
		// No host-side contribution: highlights, notes, tags, and dot navigation are all handled inside the page.
		void ctx;
	}
};
