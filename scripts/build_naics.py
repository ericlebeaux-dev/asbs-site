#!/usr/bin/env python3
"""Rebuild assets/codes/naics-2022.json from the Census Bureau workbook.

The committed JSON is the file the site serves. Run this only to refresh it
from the official source. It does not download NIGP codes.
"""

import hashlib
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

SOURCE = "https://www.census.gov/naics/2022NAICS/2-6%20digit_2022_Codes.xlsx"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "codes" / "naics-2022.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def sector_for(code):
    number = int(code[:2])
    if 31 <= number <= 33:
        return "31-33"
    if 44 <= number <= 45:
        return "44-45"
    if 48 <= number <= 49:
        return "48-49"
    return code[:2]


def rows_from_xlsx(blob):
    workbook = zipfile.ZipFile(BytesIO(blob))
    shared = []
    root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    for item in root.findall("m:si", NS):
        shared.append("".join((node.text or "") for node in item.findall(".//m:t", NS)))
    sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    parsed = []
    for row in sheet.findall("m:sheetData/m:row", NS):
        values = {}
        for cell in row.findall("m:c", NS):
            column = "".join(char for char in cell.get("r") if char.isalpha())
            node = cell.find("m:v", NS)
            value = "" if node is None or node.text is None else node.text
            if cell.get("t") == "s":
                value = shared[int(value)]
            values[column] = value.strip()
        if values.get("B"):
            parsed.append((values["B"], values.get("C", "")))
    return parsed


def main():
    request = urllib.request.Request(SOURCE, headers={"User-Agent": "ASBS-naics-build/1.0"})
    blob = urllib.request.urlopen(request, timeout=60).read()
    print("xlsx sha256", hashlib.sha256(blob).hexdigest())
    parsed = rows_from_xlsx(blob)
    sectors = []
    seen = set()
    for code, title in parsed:
        if code in {"31-33", "44-45", "48-49"} or (code.isdigit() and len(code) == 2):
            if code not in seen:
                sectors.append([code, title])
                seen.add(code)
    codes = []
    for code, title in parsed:
        if code.isdigit() and len(code) == 6:
            sector = sector_for(code)
            if sector not in seen:
                sys.exit(f"missing sector {sector} for {code}")
            codes.append([code, title, sector])
    data = {
        "vintage": 2022,
        "source": "U.S. Census Bureau",
        "file": "2-6 digit_2022_Codes.xlsx",
        "url": SOURCE,
        "retrieved": "2026-11-10",
        "workbookModified": "2021-11-16",
        "license": "U.S. government work. Public domain.",
        "sectors": sectors,
        "codes": codes,
    }
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(text + "\n", encoding="utf-8")
    print(f"wrote {len(codes)} codes, {len(sectors)} sectors, sha256 {hashlib.sha256(text.encode()).hexdigest()}")


if __name__ == "__main__":
    main()
