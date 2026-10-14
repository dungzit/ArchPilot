# Prompt Engineering Specification

## Mục tiêu
Chuẩn hóa prompt cho Demo V1, đảm bảo output ổn định và có cấu trúc JSON.

## Nguyên tắc
- Luôn trả về JSON hợp lệ.
- Không trả về markdown nếu schema yêu cầu JSON.
- Không giải thích ngoài schema.

## Prompt Chain
1. Requirement Analysis
2. Architecture Generation
3. Sizing Generation
4. Diagram Generation
5. Proposal Generation

## Requirement Analysis Prompt
### System
You are a Senior Enterprise Architect...

### Validation
- Required fields
- TPS > 0
- Concurrent Users > 0

### Output Contract
workloadSummary
nfr[]
securityRequirements[]
availabilityRequirements[]
scalabilityRequirements[]
assumptions[]

## Architecture Generator Prompt
### Objective
Generate enterprise architecture.

### Mandatory Components
- Entry Layer
- Application Layer
- Data Layer
- Observability Layer

### Output Contract
architectureSummary
components[]
dataFlow[]
designDecisions[]
risks[]

## Sizing Prompt
### Objective
Generate baseline sizing only.

### Rules
- Never use exact production sizing wording.
- Mark as estimation.

## Proposal Prompt
Generate complete markdown proposal.

## AI Quality Checklist
- JSON valid
- Risks identified
- Assumptions documented
- Architecture readable
