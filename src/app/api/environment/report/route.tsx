import { NextResponse } from 'next/server';
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import React from 'react';

const styles = StyleSheet.create({
    page: {
        fontFamily: 'Helvetica',
        fontSize: 11,
        paddingTop: 60,
        paddingBottom: 60,
        paddingHorizontal: 60,
        color: '#1a1a1a',
        lineHeight: 1.6,
    },
    header: {
        marginBottom: 32,
        borderBottomWidth: 1,
        borderBottomColor: '#d4d4d4',
        paddingBottom: 16,
    },
    label: {
        fontSize: 9,
        color: '#6b7280',
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    title: {
        fontSize: 20,
        fontFamily: 'Helvetica-Bold',
        color: '#111827',
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 10,
        color: '#6b7280',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 13,
        fontFamily: 'Helvetica-Bold',
        color: '#111827',
        marginBottom: 8,
        paddingBottom: 4,
        borderBottomWidth: 0.5,
        borderBottomColor: '#e5e7eb',
    },
    subTitle: {
        fontSize: 11,
        fontFamily: 'Helvetica-Bold',
        color: '#374151',
        marginTop: 10,
        marginBottom: 4,
    },
    body: {
        fontSize: 10.5,
        color: '#374151',
        lineHeight: 1.65,
        marginBottom: 6,
    },
    bulletRow: {
        flexDirection: 'row',
        marginBottom: 5,
        paddingLeft: 8,
    },
    bulletMark: {
        fontSize: 10.5,
        color: '#6b7280',
        marginRight: 8,
        width: 12,
    },
    bulletText: {
        fontSize: 10.5,
        color: '#374151',
        lineHeight: 1.6,
        flex: 1,
    },
    bold: {
        fontFamily: 'Helvetica-Bold',
    },
    infoBox: {
        backgroundColor: '#f9fafb',
        borderWidth: 0.5,
        borderColor: '#e5e7eb',
        borderRadius: 4,
        padding: 10,
        marginBottom: 10,
    },
    infoBoxTitle: {
        fontSize: 10,
        fontFamily: 'Helvetica-Bold',
        color: '#374151',
        marginBottom: 6,
    },
    sourcesTitle: {
        fontSize: 10,
        fontFamily: 'Helvetica-Bold',
        color: '#6b7280',
        marginBottom: 6,
    },
    sourceItem: {
        fontSize: 9,
        color: '#9ca3af',
        marginBottom: 3,
    },
    footer: {
        fontSize: 8.5,
        color: '#9ca3af',
        marginTop: 12,
        borderTopWidth: 0.5,
        borderTopColor: '#e5e7eb',
        paddingTop: 8,
    },
    pageNumber: {
        position: 'absolute',
        bottom: 30,
        right: 60,
        fontSize: 9,
        color: '#9ca3af',
    },
});

function Bullet({ children }: { children: React.ReactNode }) {
    return (
        <View style={styles.bulletRow}>
            <Text style={styles.bulletMark}>–</Text>
            <Text style={styles.bulletText}>{children}</Text>
        </View>
    );
}

function NumberedBullet({ n, children }: { n: string; children: React.ReactNode }) {
    return (
        <View style={styles.bulletRow}>
            <Text style={styles.bulletMark}>{n}.</Text>
            <Text style={styles.bulletText}>{children}</Text>
        </View>
    );
}

const ReportDocument = () => (
    <Document
        title="Tripplet Environmental Report"
        author="Tripplet"
        subject="Environmental Values & Commitments"
    >
        <Page size="A4" style={styles.page}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.label}>Environmental Report</Text>
                <Text style={styles.title}>Tripplet's Environmental Footprint, Honestly</Text>
                <Text style={styles.subtitle}>Last updated: June 2026</Text>
            </View>

            {/* Section 1 */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>1. Our history with the environment</Text>
                <Text style={styles.body}>
                    Environmental thinking isn't new to us. Before Tripplet existed, our team built Nova Earth in September 2023 — an interactive web browser that planted trees and encouraged community service. We shipped a product that directly connected technology use with environmental action.
                </Text>
                <Text style={styles.body}>
                    When we built Tripplet, that same thinking carried over. We believe that every technology company has a responsibility to understand and minimize its environmental impact — and to be transparent about the parts it can't yet control.
                </Text>
            </View>

            {/* Section: How Tripplet is built */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>2. How Tripplet is actually built</Text>
                <Text style={styles.body}>
                    You can't judge our footprint without knowing what Tripplet is. So, plainly:
                </Text>
                <Bullet><Text style={styles.bold}>We don't train models.</Text> Our models — Astro, Taipei, Majuli, and Suzhou — are configurations of open-weight models that other labs already trained and released. Training is the single largest energy and water cost in AI, and we add none of it: reusing an already-trained model creates no new training footprint.</Bullet>
                <Bullet><Text style={styles.bold}>We don't run data centers.</Text> Inference runs on third-party providers — our default provider, with a separate gateway for the Astro flagship. We do not own that hardware or the power feeding it, so we cannot directly choose its energy source or cooling method.</Bullet>
                <Bullet><Text style={styles.bold}>Our direct impact is inference only.</Text> Each message is one model call on infrastructure we rent. That is a real cost, but a small slice of AI's total footprint — and the only slice we touch.</Bullet>
            </View>

            {/* Section 3 */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>3. The environmental cost of AI — industry context</Text>
                <Text style={styles.body}>
                    The figures below come from published research and other companies' disclosures. They describe the scale of the industry, not Tripplet's own stack — we include them as honest backdrop, not as our numbers.
                </Text>

                <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>Energy</Text>
                    <Bullet>Data centers account for roughly 1.5% of global electricity consumption, with AI cited as a key growth driver (IEA, Electricity 2024).</Bullet>
                    <Bullet>An AI query is often estimated to use several times the energy of a plain web search — the popular "~10x" figure is a rough, widely-repeated estimate, and the real number varies with model size and prompt length.</Bullet>
                    <Bullet>Efficient inference is a genuine lever: our default provider builds inference-specialized chips designed for high throughput per watt. We cannot independently audit any provider's grid mix.</Bullet>
                </View>

                <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>Water</Text>
                    <Bullet>Microsoft reported a 34% increase in water consumption from 2021 to 2022, attributed in part to AI workloads (Microsoft 2022 Environmental Sustainability Report) — Microsoft's infrastructure, not Tripplet's.</Bullet>
                    <Bullet>Google's data centers used 5.6 billion gallons of water in 2022 across all operations, not AI specifically (Google 2023 Environmental Report).</Bullet>
                    <Bullet>Researchers at UC Riverside estimated approximately 0.5 liters of water per conversation (5–50 prompts) for GPT-3.5-class models on Azure (Li et al., "Making AI Less Thirsty," 2023). A research estimate, not an official disclosure, and not measured on our stack.</Bullet>
                </View>

                <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>The water cycle nuance</Text>
                    <Bullet>Most data center water is used in evaporative cooling. Unlike fossil fuels, this water is not destroyed — it evaporates and re-enters the water cycle.</Bullet>
                    <Bullet>However, this does NOT mean it's environmentally neutral. Water evaporates locally but may precipitate in a completely different region. Local communities still experience real water stress from these withdrawals.</Bullet>
                    <Bullet>Data center location matters more than total volume. A facility in a water-rich area has a fundamentally different impact than one in a drought zone.</Bullet>
                </View>
            </View>

            <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        </Page>

        <Page size="A4" style={styles.page}>
            {/* Section 4 */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>4. What we can honestly point to</Text>
                <Text style={styles.body}>
                    These are the real, in-our-control choices baked into how Tripplet works — not things the industry "could theoretically do."
                </Text>

                <Text style={styles.subTitle}>Reuse instead of retrain</Text>
                <Text style={styles.body}>
                    Because we build on open-weight models, we never run a training job. The heaviest part of AI's footprint simply isn't ours to add. Open-sourcing Tripplet under the Unlicense extends the same logic: other builders extend our work rather than re-deriving and re-running the same compute from zero.
                </Text>

                <Text style={styles.subTitle}>Right-sized models</Text>
                <Text style={styles.body}>
                    Not every query needs the biggest model. Guests default to our smallest model, Majuli handles fast/concise work, and the heavyweight reasoning models (Astro, Taipei) are reserved for tasks that actually need them. Matching the model to the job avoids spending large-model compute on small-model questions.
                </Text>

                <Text style={styles.subTitle}>Less waste per request</Text>
                <Text style={styles.body}>
                    We cap streaming timeouts so hung requests don't burn compute indefinitely, cache system prompts, avoid unnecessary API retries, and trim output length on fast models. Individually small; meaningful across millions of requests.
                </Text>

                <Text style={styles.subTitle}>Concise mode</Text>
                <Text style={styles.body}>
                    Users can toggle "concise" tone in any chat. Shorter responses mean fewer tokens generated and less inference time, which directly reduces the compute and energy per interaction.
                </Text>
            </View>

            {/* Section 5 */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>5. What we can't claim yet</Text>
                <Text style={styles.body}>Transparency means being honest about gaps, not just wins:</Text>
                <Bullet>We cannot give you a precise per-conversation figure for energy or water. Anyone quoting an exact number for a model hosted by a third party is guessing.</Bullet>
                <Bullet>We do not have independent visibility into our providers' full energy mix or water-usage breakdown, and we will not claim they run on 100% carbon-free power without data to back it.</Bullet>
                <Bullet>The figures elsewhere in this report come from academic research and other companies' disclosures — not Tripplet-specific measurements.</Bullet>
                <Bullet>We are working to obtain infrastructure-level environmental data from our providers, and will move items into the previous section as we can substantiate them.</Bullet>
            </View>

            {/* Section 6 */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>6. The bigger picture — AI and the environment</Text>
                <Text style={styles.body}>It's not all bad news. AI is also being used to help the environment in meaningful, measurable ways:</Text>
                <Bullet>Materials discovery: Google DeepMind's GNoME project discovered 2.2 million new crystal structures in 2023, accelerating development of better solar cells and batteries (published in Nature).</Bullet>
                <Bullet>Grid optimization: ML models are deployed for real-time power grid optimization, reducing waste in electricity distribution.</Bullet>
                <Bullet>Weather forecasting: AI-assisted climate modeling has improved forecast accuracy, enabling better renewable energy dispatch decisions.</Bullet>
                <Bullet>Reduced lab waste: AlphaFold and similar tools have accelerated drug and materials research, reducing the amount of physical experimentation needed.</Bullet>
            </View>

            {/* Section 7 */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>7. Our commitment</Text>
                <Text style={styles.body}>We commit to the following:</Text>
                <NumberedBullet n="1">Continued transparency. We will update this report as we learn more about our infrastructure's environmental profile.</NumberedBullet>
                <NumberedBullet n="2">Efficiency by default. We will continue to optimize model selection, caching, and inference to minimize resource usage per query.</NumberedBullet>
                <NumberedBullet n="3">Open source. We will keep Tripplet open source so others can build on shared infrastructure rather than duplicating compute.</NumberedBullet>
                <NumberedBullet n="4">No greenwashing. We will not make environmental claims we can't substantiate. If we don't know something, we'll say so.</NumberedBullet>
            </View>

            {/* Sources */}
            <View style={styles.section}>
                <Text style={styles.sourcesTitle}>Sources</Text>
                <Text style={styles.sourceItem}>Microsoft 2022 Environmental Sustainability Report</Text>
                <Text style={styles.sourceItem}>Google 2023 Environmental Report</Text>
                <Text style={styles.sourceItem}>Li, P. et al. (2023) "Making AI Less Thirsty: Uncovering and Addressing the Secret Water Footprint of AI Models," UC Riverside</Text>
                <Text style={styles.sourceItem}>IEA, Electricity 2024</Text>
                <Text style={styles.sourceItem}>Merchant, A. et al. (2023) "Scaling deep learning for materials discovery," Nature 624</Text>
                <Text style={styles.footer}>
                    Tripplet runs inference on third-party providers (our default provider, plus a separate gateway for the Astro flagship) using open-weight models we did not train; we do not operate data centers. Figures reflect published estimates and company disclosures as of 2022–2024 and describe the broader industry, not Tripplet-specific measurements. Environmental accounting for AI is an emerging field and methodologies vary significantly across studies.
                </Text>
            </View>

            <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        </Page>
    </Document>
);

export async function GET() {
    const buffer = await renderToBuffer(<ReportDocument />);

    return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline; filename="tripplet-environmental-report.pdf"',
            'Cache-Control': 'public, max-age=86400',
        },
    });
}
