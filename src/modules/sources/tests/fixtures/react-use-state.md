---
title: useState
---

<Intro>

Keep a local counter value and update it from a button handler.

</Intro>

## Reference {/*reference*/}

Use a state value and its setter inside the component.

<Sandpack>

```jsx title="Counter.jsx"
import {useState} from 'react';

export function Counter() {
  const [value, setValue] = useState(0);
  return <button onClick={() => setValue(value + 1)}>{value}</button>;
}
```

</Sandpack>

## Usage {/*usage*/}

Call the setter from an event handler to request a new render.
