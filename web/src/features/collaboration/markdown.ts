import MarkdownIt from "markdown-it";
const renderer = new MarkdownIt({ html: false, linkify: false, breaks: true });
renderer.disable("image");
export const renderDescription = (text: string) => renderer.render(text);
