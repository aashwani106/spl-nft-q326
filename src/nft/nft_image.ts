import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createGenericFile } from "@metaplex-foundation/umi";
import { runCli } from "../cli";
import { updateState } from "../state";
import { createAssignmentUmi } from "../umi";
import { elapsedMs, withTimeout } from "../diagnostics";

export function inferImageContentType(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  return "image/jpeg";
}

export async function uploadNftImage(imagePath = process.env.NFT_IMAGE_PATH ?? "image.jpeg") {
  const { umi } = createAssignmentUmi({ uploader: true });
  const absolutePath = resolve(imagePath);
  const bytes = await readFile(absolutePath);
  if (bytes.length === 0) throw new Error(`Image is empty: ${absolutePath}`);
  const startedAt = Date.now();
  console.log(`[upload] NFT image: file=${absolutePath} bytes=${bytes.length}`);
  const [imageUri] = await withTimeout(
    "NFT image upload",
    umi.uploader.upload([
      createGenericFile(bytes, basename(absolutePath), {
        contentType: inferImageContentType(absolutePath),
      }),
    ]),
  );
  console.log(`[upload] NFT image: uri=${imageUri} elapsed=${elapsedMs(startedAt)}ms`);
  updateState({ imageUri });
  return imageUri;
}

async function main() {
  console.log(`Image URI: ${await uploadNftImage()}`);
}

if (require.main === module) runCli(main);
