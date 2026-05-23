import { describe, expect, it } from "vitest";

import { buildZipArchive } from "./zip";

describe("buildZipArchive", () => {
  it("stores JSON entries in a valid uncompressed zip archive", () => {
    const archive = buildZipArchive([
      { name: "first.json", data: "{\"email\":\"first@example.com\"}\n" },
      { name: "nested/second.json", data: "{\"email\":\"second@example.com\"}\n" },
    ]);

    expect(archive.subarray(0, 4).toString("binary")).toBe("PK\u0003\u0004");
    expect(readLocalEntries(archive)).toEqual([
      {
        name: "first.json",
        data: "{\"email\":\"first@example.com\"}\n",
      },
      {
        name: "second.json",
        data: "{\"email\":\"second@example.com\"}\n",
      },
    ]);
  });
});

function readLocalEntries(archive: Buffer) {
  const entries: Array<{ name: string; data: string }> = [];
  let offset = 0;

  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    entries.push({
      name: archive.subarray(nameStart, nameStart + fileNameLength).toString("utf8"),
      data: archive.subarray(dataStart, dataStart + compressedSize).toString("utf8"),
    });
    offset = dataStart + compressedSize;
  }

  return entries;
}
