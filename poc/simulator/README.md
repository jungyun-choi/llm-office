# Synthetic FlashSim

Synthetic FlashSim은 AI Office의 OpenCode 오케스트레이션 흐름을 검증하기 위한
작은 가상 SSD/UFS 성능 시뮬레이터입니다. 회사 코드, 설계, 수치 또는 명칭을
사용하지 않습니다.

## 실행

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 src/simulator.py --workload mixed
```

지원 workload는 `read-heavy`, `write-heavy`, `mixed`입니다. 모델은 의도적으로
단순하며 정확한 저장장치 동작을 재현하지 않습니다.

## POC 요청 예시

> mixed workload에 고정 크기 write buffer 모델을 추가하고 buffer hit ratio와
> flush 횟수를 결과에 포함해 줘. 기존 workload와 호환되어야 해.

AI Office는 이 합성 저장소만 읽어 조사, 영향 분석, 견적, 테스트 계획과 Git
이슈 초안을 만듭니다. POC 입력에는 실제 사내 정보를 붙여 넣지 마세요.
