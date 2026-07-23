FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    r-base-core \
    r-cran-mgcv \
    r-cran-jsonlite \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    fastapi \
    'uvicorn[standard]' \
    httpx \
    pandas \
    pyarrow \
    numpy \
    mercantile

COPY provider/ provider/

RUN Rscript -e 'suppressMessages({library(mgcv); library(jsonlite)}); cat("r-ok\n")'

CMD ["uvicorn", "provider.app:app", "--host", "0.0.0.0", "--port", "8080"]
