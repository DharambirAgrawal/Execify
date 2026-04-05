# Execify Use Cases & Integration Guide

## Table of Contents
1. [AI Agent Integration](#ai-agent-integration)
2. [LeetCode Platform](#leetcode-platform)
3. [Document Generation Service](#document-generation-service)
4. [Report Generator](#report-generator)
5. [Workflow Automation](#workflow-automation)

---

## AI Agent Integration

### Use Case: Claude or GPT Agent

Use Execify as a code execution backend for AI agents to:
- Write and run code to solve problems
- Generate files and documents
- Process data
- Execute algorithms

### Python Agent Example

```python
import requests
import json
import base64

class ExecutifyAgent:
    def __init__(self, api_key, endpoint="http://localhost:3000"):
        self.api_key = api_key
        self.endpoint = endpoint
        self.session = requests.Session()
        self.session.headers.update({"X-API-Key": api_key})
    
    def run_code(self, language, code, files=None):
        """Execute code and get result"""
        response = self.session.post(
            f"{self.endpoint}/run",
            json={
                "type": "execute",
                "language": language,
                "code": code,
                "files": files or []
            }
        )
        return response.json()
    
    def solve_problem(self, problem_description, code):
        """Example: Solve a problem with generated code"""
        result = self.run_code("python", code)
        
        if result.get("stderr"):
            return f"Error: {result['stderr']}"
        
        return result.get("stdout", "No output")
    
    def generate_report(self, dataset):
        """Generate JSON report from data"""
        code = f"""
import json
data = {dataset}
report = {{
    "total_items": len(data),
    "sum": sum(data) if data else 0,
    "average": sum(data) / len(data) if data else 0
}}
with open("/workspace/report.json", "w") as f:
    json.dump(report, f, indent=2)
print("Report generated")
"""
        return self.run_code("python", code)

# Usage
agent = ExecutifyAgent("test-key-123")

# Solve problem
code = """
def find_missing(arr):
    n = len(arr) + 1
    total = n * (n + 1) // 2
    return total - sum(arr)

result = find_missing([1, 2, 3, 5])
print(f"Missing: {result}")
"""
result = agent.solve_problem("Find missing number", code)
print(result)  # Missing: 4
```

### JavaScript Agent Example

```javascript
const axios = require('axios');

class ExecutifyAgent {
  constructor(apiKey, endpoint = 'http://localhost:3000') {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.axiosInstance = axios.create({
      headers: { 'X-API-Key': apiKey }
    });
  }

  async runCode(language, code, files = null) {
    const response = await this.axiosInstance.post(`${this.endpoint}/run`, {
      type: 'execute',
      language,
      code,
      files: files || []
    });
    return response.data;
  }

  async solveAlgorithm(code) {
    const result = await this.runCode('node', code);
    if (result.stderr) return `Error: ${result.stderr}`;
    return result.stdout;
  }

  async generateJsonReport(data) {
    const code = `
const data = ${JSON.stringify(data)};
const fs = require('fs');
const report = {
  items: data.length,
  sum: data.reduce((a, b) => a + b, 0),
  average: data.reduce((a, b) => a + b, 0) / data.length
};
fs.writeFileSync('/workspace/report.json', JSON.stringify(report, null, 2));
console.log('Report generated');
`;
    return this.runCode('node', code);
  }
}

// Usage
const agent = new ExecutifyAgent('test-key-123');

const code = `
function findMissing(arr) {
  const n = arr.length + 1;
  const total = (n * (n + 1)) / 2;
  return total - arr.reduce((a, b) => a + b, 0);
}
console.log('Missing:', findMissing([1, 2, 3, 5]));
`;

agent.solveAlgorithm(code).then(output => console.log(output));
```

---

## LeetCode Platform

### Running LeetCode-Style Problems on Execify

```python
# Create a LeetCode platform backend

class LeetcodePlatform:
    def __init__(self, execify_client):
        self.execify = execify_client
    
    def submit_solution(self, problem_id, solution_code, language, test_cases):
        """Test a solution against test cases"""
        
        results = []
        
        for i, (input_data, expected_output) in enumerate(test_cases):
            test_code = f"""
{solution_code}

# Run test case {i}
input_data = {input_data}
result = solution(input_data)
print(result)
"""
            execution = self.execify.run_code(language, test_code)
            
            output = execution.get("stdout", "").strip()
            passed = output == str(expected_output).strip()
            
            results.append({
                "test_case": i,
                "input": input_data,
                "expected": expected_output,
                "actual": output,
                "passed": passed,
                "time_ms": execution.get("duration", 0)
            })
        
        passed_count = sum(1 for r in results if r["passed"])
        total_count = len(results)
        
        return {
            "problem_id": problem_id,
            "passed": f"{passed_count}/{total_count}",
            "test_results": results,
            "success": passed_count == total_count
        }

# Example problem
solution = """
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []
"""

platform = LeetcodePlatform(execify_agent)
result = platform.submit_solution(
    problem_id=1,
    solution_code=solution,
    language="python",
    test_cases=[
        ([2, 7, 11, 15], [4, 9], [0, 1]),
        ([3, 2, 4], [6], [1, 2]),
    ]
)

print(result)
# {
#   "passed": "2/2",
#   "success": true,
#   "test_results": [...]
# }
```

---

## Document Generation Service

### Creating Reports, DOCX, and PDFs

```python
class DocumentGenerator:
    def __init__(self, execify_client):
        self.execify = execify_client
    
    def generate_pdf_report(self, data, title):
        """Generate PDF report from data"""
        
        # Step 1: Generate DOCX using python-docx
        docx_code = f'''
from docx import Document
from docx.shared import Pt, Inches
from datetime import datetime

doc = Document()
doc.add_heading("{title}", 0)
doc.add_paragraph(f"Generated: {{datetime.now()}}")

# Add content
doc.add_heading("Summary", level=1)
data = {data}
for key, value in data.items():
    doc.add_paragraph(f"{{key}}: {{value}}")

doc.save("/workspace/report.docx")
print("DOCX created")
'''
        
        result = self.execify.run_code("python", docx_code)
        if result.get("stderr"):
            raise Exception(f"DOCX creation failed: {result['stderr']}")
        
        # Step 2: Convert DOCX to PDF
        # Get DOCX file and convert
        files = self.list_workspace_files()
        docx_file = next((f for f in files if f.endswith(".docx")), None)
        
        if docx_file:
            docx_content = self.read_file(docx_file)
            pdf = self.convert_docx_to_pdf(docx_content, docx_file)
            return pdf
        
        return None
    
    def list_workspace_files(self):
        result = self.execify.run_code("python", "import os; print(os.listdir('/workspace'))")
        return eval(result["stdout"]) if result["stdout"] else []
    
    def read_file(self, filename):
        import base64
        result = self.execify.run_code("python", f"with open('/workspace/{filename}', 'rb') as f: print(__import__('base64').b64encode(f.read()).decode())")
        return result["stdout"].strip()
    
    def convert_docx_to_pdf(self, docx_content, filename):
        # Call /convert/docx-to-pdf endpoint
        response = requests.post(
            f"{self.execify.endpoint}/convert/docx-to-pdf",
            headers={"X-API-Key": self.execify.api_key},
            json={
                "file": docx_content,
                "filename": filename
            }
        )
        return response.json()

# Usage
generator = DocumentGenerator(execify_agent)
pdf = generator.generate_pdf_report(
    data={"Revenue": "$1.2M", "Users": "5000", "Growth": "25%"},
    title="Q1 2026 Report"
)
```

---

## Report Generator

### Automated Report Generation Pipeline

```python
class ReportingPipeline:
    def __init__(self, execify_client, api_keys):
        self.execify = execify_client
        self.github_token = api_keys.get("github")
    
    def generate_monthly_report(self, month):
        """Generate comprehensive monthly report"""
        
        # Fetch data from APIs
        repo_data = self.fetch_github_stats()
        
        # Process data
        analysis = self.analyze_data(repo_data)
        
        # Generate report files
        json_report = self.create_json_report(analysis)
        csv_export = self.create_csv_export(analysis)
        markdown_doc = self.create_markdown_doc(analysis)
        
        # Create archive
        archive = self.create_archive([json_report, csv_export, markdown_doc])
        
        return archive
    
    def fetch_github_stats(self):
        """Fetch GitHub repository stats"""
        code = f'''
import requests
headers = {{"Authorization": "token {self.github_token}"}}
repo = requests.get(
    "https://api.github.com/repos/DharambirAgrawal/Execify",
    headers=headers
).json()
print({{"stars": repo["stargazers_count"], "forks": repo["forks_count"]}})
'''
        result = self.execify.run_code("python", code)
        return eval(result["stdout"])
    
    def analyze_data(self, data):
        """Analyze and process data"""
        code = f'''
import json
data = {data}
analysis = {{
    "snapshot": data,
    "growth_rate": 1.15,
    "health_score": 92.5,
    "recommendations": [
        "Increase visibility on social media",
        "Improve documentation",
        "Add more examples"
    ]
}}
print(json.dumps(analysis))
'''
        result = self.execify.run_code("python", code)
        return json.loads(result["stdout"])
    
    def create_json_report(self, analysis):
        code = f'''
import json
analysis = {analysis}
with open("/workspace/report.json", "w") as f:
    json.dump(analysis, f, indent=2)
print("JSON report created")
'''
        self.execify.run_code("python", code)
        return "report.json"
    
    def create_csv_export(self, analysis):
        code = f'''
import csv
data = {analysis}
with open("/workspace/metrics.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["Metric", "Value"])
    for key in ["health_score", "growth_rate"]:
        writer.writerow([key, data.get(key)])
print("CSV created")
'''
        self.execify.run_code("python", code)
        return "metrics.csv"
    
    def create_markdown_doc(self, analysis):
        code = f'''
analysis = {analysis}
md = f"""# Monthly Report

## Metrics
- Health Score: {{analysis['health_score']}}
- Growth Rate: {{analysis['growth_rate']}}%

## Recommendations
"""
for rec in analysis['recommendations']:
    md += f"- {{rec}}\\n"

with open("/workspace/REPORT.md", "w") as f:
    f.write(md)
print("Markdown created")
'''
        self.execify.run_code("python", code)
        return "REPORT.md"
    
    def create_archive(self, files):
        code = f'''
import subprocess
subprocess.run([
    "zip", "-j", "/workspace/monthly_report.zip",
    {json.dumps(files)}
])
print("Archive created")
'''
        self.execify.run_code("python", code)
        return "monthly_report.zip"

# Usage
pipeline = ReportingPipeline(
    execify_agent,
    {"github": "your-github-token"}
)
archive = pipeline.generate_monthly_report("April 2026")
```

---

## Workflow Automation

### Multi-step Automation Workflow

```python
class AutomationWorkflow:
    def __init__(self, execify_client):
        self.execify = execify_client
    
    def extract_transform_load(self, source_url, transformations):
        """ETL pipeline"""
        
        # Extract
        extract_code = f'''
import requests
import json
response = requests.get("{source_url}")
data = response.json()
with open("/workspace/extracted.json", "w") as f:
    json.dump(data, f)
print(f"Extracted {{len(data)}} records")
'''
        self.execify.run_code("python", extract_code)
        
        # Transform
        transform_code = f'''
import json
with open("/workspace/extracted.json") as f:
    data = json.load(f)
# Apply transformations
transformed = {{transformations}}(data)
with open("/workspace/transformed.json", "w") as f:
    json.dump(transformed, f)
print(f"Transformed {{len(transformed)}} records")
'''
        self.execify.run_code("python", transform_code)
        
        # Load
        load_code = '''
import json
import csv
with open("/workspace/transformed.json") as f:
    data = json.load(f)
with open("/workspace/output.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=data[0].keys())
    writer.writeheader()
    writer.writerows(data)
print("Data loaded to CSV")
'''
        self.execify.run_code("python", load_code)
        
        return self.get_output_files()
    
    def get_output_files(self):
        code = '''
import os
import base64
files = {}
for fname in os.listdir("/workspace"):
    if fname.endswith((".json", ".csv")):
        with open(f"/workspace/{fname}", "rb") as f:
            files[fname] = base64.b64encode(f.read()).decode()
import json
print(json.dumps(files))
'''
        result = self.execify.run_code("python", code)
        return json.loads(result["stdout"])
```

---

## Summary

Execify enables:
- ✅ **AI Agents** to execute code and generate solutions
- ✅ **LeetCode Platforms** to test coding submissions
- ✅ **Document Services** to generate PDFs and reports
- ✅ **Data Pipelines** for ETL and data processing
- ✅ **Automation** for complex multi-step workflows

See `docs/examples/` for complete runnable code samples.
