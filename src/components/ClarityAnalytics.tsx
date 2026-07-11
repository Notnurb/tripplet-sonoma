'use client';

import { useEffect } from 'react';
import Clarity from '@microsoft/clarity';

const CLARITY_PROJECT_ID = 'xki5h68q91';

export function ClarityAnalytics() {
    useEffect(() => {
        Clarity.init(CLARITY_PROJECT_ID);
    }, []);

    return null;
}
