"""Shared test fixtures — creates local sample PDFs required by suites."""
import pytest
from reportlab.pdfgen import canvas


def _make_pdf(path, text):
    c = canvas.Canvas(path)
    c.drawString(100, 750, text)
    c.showPage()
    c.save()


@pytest.fixture(scope="session", autouse=True)
def sample_pdfs():
    _make_pdf("/tmp/pdi_test.pdf", "PDI TEST DOCUMENT")
    _make_pdf("/tmp/sample_invoice.pdf", "TAX INVOICE 26-27/9999 TEST SAMPLE")
