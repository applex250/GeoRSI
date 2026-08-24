"""Data classes for the RSI loop."""
from dataclasses import dataclass, field, asdict
import json

@dataclass
class Scaffold:
    system_prompt: str
    tips: list = field(default_factory=list)
    generation: int = 0

    def to_dict(self): return asdict(self)

    @classmethod
    def from_dict(cls, d): return cls(**d)

    def save(self, path):
        json.dump(self.to_dict(), open(path, "w"), indent=2, ensure_ascii=False)

    @classmethod
    def load(cls, path):
        d = json.load(open(path))
        return cls.from_dict(d)

    def clone(self):
        return Scaffold(
            system_prompt=self.system_prompt,
            tips=list(self.tips),
            generation=self.generation,
        )
