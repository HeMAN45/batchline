"""Prepare monthly UCI Online Retail CSVs for the controlled benchmark."""

import argparse
import csv
from collections import Counter, defaultdict
from contextlib import ExitStack
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
from shutil import copyfileobj
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from openpyxl import load_workbook


HEADERS = ('order_id', 'sku', 'date', 'category', 'region', 'quantity', 'unit_price', 'revenue')


def prepare(workbook_path, target):
    workbook = load_workbook(workbook_path, read_only=True, data_only=True)
    rows = workbook.active.iter_rows(values_only=True)
    columns = next(rows)
    expected = ('InvoiceNo', 'StockCode', 'Description', 'Quantity', 'InvoiceDate', 'UnitPrice', 'CustomerID', 'Country')
    if tuple(columns) != expected:
        raise ValueError('The workbook must use the UCI Online Retail schema.')
    totals = Counter()
    seen = defaultdict(set)
    writers = {}
    try:
        with ExitStack() as stack:
            for invoice, sku, description, quantity, date, price, _, country in rows:
                totals['source'] += 1
                if not all(str(value or '').strip() for value in (invoice, sku, description, country)) or not isinstance(date, datetime):
                    totals['missing_metadata'] += 1
                    continue
                try:
                    quantity_value = int(quantity)
                    price_value = Decimal(str(price))
                    if quantity_value != quantity or not price_value.is_finite() or price_value < 0:
                        raise ValueError
                except (ValueError, OverflowError, InvalidOperation, TypeError):
                    totals['invalid_measures'] += 1
                    continue
                if quantity_value < 0 and not re.fullmatch(r'C\d+', str(invoice), re.IGNORECASE):
                    totals['negative_without_cancellation_id'] += 1
                    continue
                row = (str(invoice).strip(), str(sku).strip(), date.date().isoformat(), str(description).strip(),
                       str(country).strip(), quantity_value, format(price_value, 'f'), format(quantity_value * price_value, '.2f'))
                month = date.strftime('%Y-%m')
                if row in seen[month]:
                    totals['exact_projected_duplicates'] += 1
                    continue
                seen[month].add(row)
                if month not in writers:
                    handle = stack.enter_context((target / f'{month}.csv').open('w', encoding='utf-8', newline=''))
                    writers[month] = csv.writer(handle)
                    writers[month].writerow(HEADERS)
                writers[month].writerow(row)
                totals['included'] += 1
    finally:
        workbook.close()
    return totals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path, help='Downloaded UCI ZIP or extracted XLSX')
    parser.add_argument('output', type=Path, help='Directory for prepared monthly files')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.workbook.suffix.lower() == '.zip':
        with TemporaryDirectory() as temp, ZipFile(args.workbook) as archive:
            member = next(name for name in archive.namelist() if name.lower().endswith('.xlsx'))
            workbook = Path(temp) / 'retail.xlsx'
            with archive.open(member) as source, workbook.open('wb') as target:
                copyfileobj(source, target)
            totals = prepare(workbook, args.output)
    else:
        totals = prepare(args.workbook, args.output)
    print(dict(totals))


if __name__ == '__main__':
    main()
