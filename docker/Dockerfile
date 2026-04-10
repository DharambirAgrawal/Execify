FROM node:18-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    libreoffice \
    zip \
    unzip \
    && rm -rf /var/lib/apt/lists/*


RUN pip3 install --break-system-packages \
    python-docx \
    pandas \
    openpyxl \
    requests \
    pillow

RUN useradd -m -u 1001 sandboxuser

RUN mkdir -p /workspace && chown sandboxuser:sandboxuser /workspace

USER sandboxuser

WORKDIR /workspace

CMD ["tail", "-f", "/dev/null"]
# it keeps the container alive and doing nothing. Your server will reach into it to run jobs.
