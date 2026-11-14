import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no pointer capture or layout scrolling; UI primitives use these browser APIs.
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

afterEach(cleanup);
