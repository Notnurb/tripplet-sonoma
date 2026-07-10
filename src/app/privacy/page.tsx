'use client';

import { LandingHeader } from '@/components/ui/landing-header';
import { LandingFooter } from '@/components/ui/landing-footer';
import { motion } from 'framer-motion';

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const fadeUp = {
    hidden: { opacity: 0, y: 20, filter: 'blur(8px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease } },
};

const sections = [
    {
        title: '1. Information We Collect',
        content: [
            'Account Information: When you create an account, we collect your name, email address, and authentication credentials through our identity provider (Clerk). We do not store passwords directly.',
            'Usage Data: We collect information about how you interact with the platform, including features used, timestamps, model selections, and session duration. This helps us improve the product.',
            'Conversations: Your chat messages and AI responses are stored to provide conversation history and continuity. Image generation prompts are stored temporarily to process your requests.',
            'Device Information: We collect basic device information such as browser type, operating system, and screen resolution for analytics and to ensure compatibility.',
            'Cookies: We use essential cookies for authentication and session management. We do not use third-party advertising cookies.',
        ],
    },
    {
        title: '2. How We Use Your Information',
        content: [
            'Providing the Service: Your information is used to operate Tripplet, process AI requests, maintain your conversation history, and personalize your experience.',
            'Improving the Platform: Anonymized and aggregated usage data helps us understand which features matter most and where to focus development effort.',
            'Communication: We may send you service-related notifications (account security, feature updates, subscription changes). You can opt out of non-essential communications.',
            'Safety: We monitor usage patterns to detect and prevent abuse, fraud, and violations of our Terms of Service.',
        ],
    },
    {
        title: '3. Data Storage and Security',
        content: [
            'Infrastructure: Data is stored using industry-standard cloud infrastructure with encryption at rest and in transit. Database services are provided by Neon with PostgreSQL.',
            'Access Controls: Only essential personnel have access to user data, and all access is logged and audited.',
            'Retention: Conversation data is retained as long as your account is active. When you delete a conversation, it is permanently removed from our systems within 30 days. Account deletion removes all associated data.',
            'Authentication: Account authentication is handled by Clerk, a third-party identity provider. Clerk processes your authentication data according to their own privacy policy.',
        ],
    },
    {
        title: '4. AI Model Interactions',
        content: [
            'Processing: When you send a message, it is processed by our AI models (Taipei 3.1, Majuli 3.1, or Suzhou 3.1) hosted on our infrastructure. Your inputs are used solely to generate responses.',
            'Training: We do not use individual conversations to train or fine-tune AI models. If you opt in, your session may be used to import Wikipedia articles to improve Triplepedia models. Aggregated, anonymized patterns may be used to improve model routing and performance.',
            'Image Generation: Prompts for image generation are processed and then discarded after the content is generated. Generated media is stored in your account.',
            'Extended Thinking: When Extended Thinking is enabled, the model processes your request with additional reasoning steps. These intermediate steps are not stored permanently.',
        ],
    },
    {
        title: '5. Third-Party Services',
        content: [
            'Authentication: Clerk (identity management and social login)',
            'Database: Neon (PostgreSQL data storage)',
            'Hosting: Vercel (application hosting and edge delivery)',
            'Media Storage: AWS S3 (image file storage)',
            'Analytics: We use minimal, privacy-respecting analytics. We do not use Google Analytics or Facebook Pixel.',
            'Each third-party service processes data according to their own privacy policy. We select partners that align with our commitment to user privacy.',
        ],
    },
    {
        title: '6. Your Rights',
        content: [
            'Access: You can view all data associated with your account through the platform.',
            'Deletion: You can delete individual conversations or your entire account at any time. Account deletion is permanent and irreversible.',
            'Export: You can export your conversation history through the platform.',
            'Correction: You can update your account information at any time through your profile settings.',
            'Restriction: You can request that we limit processing of your data. Note that some limitations may affect Service functionality.',
        ],
    },
    {
        title: '7. Children\'s Privacy',
        content: [
            'Tripplet is not intended for use by individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we learn that we have collected data from a child under 13, we will delete it promptly.',
        ],
    },
    {
        title: '8. International Users',
        content: [
            'Tripplet is operated from the United States. If you access the Service from outside the United States, your data will be transferred to and processed in the United States. By using the Service, you consent to this transfer.',
            'For users in the European Economic Area (EEA), we process your data based on legitimate interest and your consent where required by GDPR.',
        ],
    },
    {
        title: '9. Changes to This Policy',
        content: [
            'We may update this Privacy Policy from time to time. If we make material changes, we will notify you through the Service or by email. Your continued use of the Service after changes constitutes acceptance of the updated policy.',
            'This policy was last updated in March 2026.',
        ],
    },
    {
        title: '10. Contact',
        content: [
            'If you have questions about this Privacy Policy or your data, you can reach us through the platform.',
        ],
    },
];

export default function Privacy() {
    return (
        <div className="flex min-h-screen w-full flex-col bg-background grain-overlay relative">
            <LandingHeader />

            <main className="grow">
                <section className="mx-auto w-full max-w-3xl px-4 pt-32 pb-20 md:pt-40 md:pb-28">
                    <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.05 } } }}>
                        <motion.p variants={fadeUp} className="text-sm font-medium text-muted-foreground mb-3">
                            Legal
                        </motion.p>
                        <motion.h1 variants={fadeUp} className="gradient-text text-3xl font-bold tracking-tight md:text-4xl">
                            Privacy Policy
                        </motion.h1>
                        <motion.p variants={fadeUp} className="mt-3 text-muted-foreground">
                            Last updated: March 2026
                        </motion.p>

                        <motion.div variants={fadeUp} className="mt-6 rounded-2xl border border-border bg-card p-5">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                <strong className="text-foreground">Summary:</strong> We collect only what we need to run the platform.
                                We don&apos;t sell your data. We don&apos;t use your conversations to train models.
                                If you opt in, your session may be used to import Wikipedia articles to improve Triplepedia models.
                                You can delete your data at any time.
                            </p>
                        </motion.div>

                        <div className="mt-12 space-y-10">
                            {sections.map((section) => (
                                <motion.div
                                    key={section.title}
                                    initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
                                    whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                    viewport={{ once: true, margin: '-40px' }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <h2 className="text-base font-semibold mb-3">{section.title}</h2>
                                    <ul className="space-y-2.5">
                                        {section.content.map((item, j) => (
                                            <li key={j} className="text-sm text-muted-foreground leading-relaxed">
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}
