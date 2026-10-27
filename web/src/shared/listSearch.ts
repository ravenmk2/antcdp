import { onBeforeUnmount } from "vue";

// Vue's v-model handles composition; query only after the final input event.
export function useListSearch(search: () => void, invalidate: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  function cancel() { clearTimeout(timer); timer = undefined; }
  function run() { cancel(); search(); }
  function input(event: Event) {
    if (composing || (event as InputEvent).isComposing) return;
    schedule();
  }
  function schedule() { cancel(); invalidate(); timer = setTimeout(run, 600); }
  function compositionStart() { composing = true; cancel(); invalidate(); }
  function compositionEnd() { composing = false; schedule(); }
  function enter(event: KeyboardEvent) {
    if (composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    run();
  }
  onBeforeUnmount(cancel);
  return { run, cancel, input, enter, compositionStart, compositionEnd };
}
