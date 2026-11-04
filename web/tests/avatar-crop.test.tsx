import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvatarEditor } from "@/features/media/AvatarEditor";
import { request } from "@/lib/api";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const drawImage = vi.fn();
const decode = vi.fn();
let encoded: Blob;
beforeEach(() => {
  encoded = new Blob(["processed png"], { type: "image/png" });
  decode.mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = 6000;
      naturalHeight = 4000;
      decode = decode;
    },
  );
  const OriginalURL = URL;
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = vi.fn(() => "blob:local-original");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    function (callback) {
      callback(encoded);
    },
  );
  vi.mocked(request).mockResolvedValue({
    data: { id: "draft", preview_url: "/api/v1/icons/draft" },
    etag: "",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function setup() {
  const onChange = vi.fn();
  render(
    <AvatarEditor
      label="图标"
      uploadPath="/icon-uploads"
      onChange={onChange}
      onProcessing={() => {}}
      compact
    />,
  );
  const file = new File(
    [new Uint8Array(3 * 1024 * 1024)],
    "large-original.jpg",
    { type: "image/jpeg" },
  );
  const input = screen.getByLabelText("上传图标文件");
  return { user: userEvent.setup(), onChange, file, input };
}
it("renders the first crop frame on canvas mount for originals over 2 MiB and 4096px", async () => {
  const { file, input, user } = setup();
  fireEvent.change(input, { target: { files: [file] } });
  const canvas = await screen.findByRole("img", { name: /图标裁剪区域/ });
  await waitFor(() => expect(drawImage).toHaveBeenCalled());
  expect(screen.getByRole("slider").getAttribute("value")).toBe("1");
  expect(canvas).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "取消裁剪" }));
  const count = drawImage.mock.calls.length;
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("dialog", { name: "裁剪图标" });
  await waitFor(() =>
    expect(drawImage.mock.calls.length).toBeGreaterThan(count),
  );
});
it("uploads only the processed PNG and enforces the limit on the output", async () => {
  const { file, input, user, onChange } = setup();
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("dialog", { name: "裁剪图标" });
  encoded = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], {
    type: "image/png",
  });
  await user.click(screen.getByRole("button", { name: "使用此图标" }));
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "裁剪图标" })).toBeTruthy();
  expect(screen.getByText(/裁剪后的图片超过 2 MiB/)).toBeTruthy();
  encoded = new Blob(["processed"], { type: "image/png" });
  await user.click(screen.getByRole("button", { name: "使用此图标" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("draft"));
  const call = vi
    .mocked(request)
    .mock.calls.find(
      ([path, options]) =>
        path === "/icon-uploads" && options?.method === "POST",
    )!;
  const uploaded = (call[1]!.body as FormData).get("file") as File;
  expect(uploaded.type).toBe("image/png");
  expect(uploaded.size).toBe(encoded.size);
  expect(drawImage).toHaveBeenCalledWith(
    expect.any(HTMLCanvasElement),
    0,
    0,
    256,
    256,
  );
});
it("reports an undecodable original without uploading or replacing the current icon", async () => {
  decode.mockRejectedValue(new Error("decode failed"));
  const { file, input, onChange } = setup();
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText(/图片无法解码/)).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
