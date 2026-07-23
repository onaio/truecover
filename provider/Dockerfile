FROM python:3.13-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi \
    'uvicorn[standard]' \
    httpx \
    pandas \
    pyarrow \
    numpy \
    mercantile

COPY provider/ provider/

CMD ["uvicorn", "provider.app:app", "--host", "0.0.0.0", "--port", "8080"]
