import sys
from pdfminer.high_level import extract_text

def extract_from_pdf(path):
    return extract_text(path)

if __name__ == '__main__':
    p = sys.argv[1]
    print(extract_from_pdf(p))
