/* dsh-highlighter — node half（host 侧占位插件）
 *
 * 功能全部在浏览器半实现。host 侧 loader 需要一个存活 fiber，
 * client-modules 才会把该 entry 的 dsh.client bundle 扫进 boot 图；
 * 因此这里提供一个不注册任何东西的空插件，保证 entry 正常激活。
 */
export default {
	apply(ctx) {
		// 无 host 侧贡献：高亮、想法、标签、圆标定位全部在页面内完成。
		void ctx;
	}
};
