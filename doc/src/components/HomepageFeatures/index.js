import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'Real-Time, ML-Powered Ranking',
    Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
    description: (
      <>
        EagleRank delivers low-latency, machine learning-based ranking for feeds and recommendations, supporting both tree-based and deep learning models for maximum flexibility.
      </>
    ),
  },
  {
    title: 'Multi-Tenancy & Data Isolation',
    Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
    description: (
      <>
        Serve multiple tenants from a single platform with strict data isolation, per-tenant configuration, and customizable ranking logic for each client or application.
      </>
    ),
  },
  {
    title: 'Robust Monitoring & Observability',
    Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
    description: (
      <>
        Integrated with Prometheus, Grafana, and OpenTelemetry for real-time metrics, health checks, and end-to-end tracing across all system components.
      </>
    ),
  },
];

function Feature({Svg, title, description}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
