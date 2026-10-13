# -*- coding: utf-8 -*-
"""
Reference list in IEEE style. Keys are used in content/*.txt as [@key].
The list printed in the report follows the order in which the text cites the entries.
Entries are written in ReportLab paragraph markup (<i> for italics, &amp; for an ampersand).
"""

ACCESSED = 'Accessed: Oct. 7, 2026.'
WIKI = 'https://openmrs.atlassian.net/wiki/spaces/%s/pages/%s'


def _wiki(title, space, page, note=''):
    return ('OpenMRS, “%s,” OpenMRS Wiki%s. %s [Online]. Available: %s'
            % (title, note, ACCESSED, WIKI % (space, page)))


def _web(author, title, site, url):
    return '%s, “%s,” %s. %s [Online]. Available: %s' % (author, title, site, ACCESSED, url)


REFS = {
    # ------------------------------------------------------------ research articles
    'mamlin2006': (
        'B. W. Mamlin <i>et al.</i>, “Cooking up an open source EMR for developing countries: '
        'OpenMRS – a recipe for successful collaboration,” in <i>AMIA Annu. Symp. Proc.</i>, '
        '2006, pp. 529–533.'),
    'mamlin2005': (
        'B. W. Mamlin and P. G. Biondich, “AMPATH Medical Record System (AMRS): collaborating '
        'toward an EMR for developing countries,” in <i>AMIA Annu. Symp. Proc.</i>, 2005, '
        'pp. 490–494.'),
    'fraser2005': (
        'H. S. F. Fraser, P. Biondich, D. Moodley, S. Choi, B. W. Mamlin, and P. Szolovits, '
        '“Implementing electronic medical record systems in developing countries,” '
        '<i>Inform. Prim. Care</i>, vol. 13, no. 2, pp. 83–95, 2005, '
        'doi: 10.14236/jhi.v13i2.585.'),
    'allen2007': (
        'C. Allen <i>et al.</i>, “Experience in implementing the OpenMRS medical record system '
        'to support HIV treatment in Rwanda,” <i>Stud. Health Technol. Inform.</i>, vol. 129, '
        'pt. 1, pp. 382–386, 2007.'),
    'seebregts2009': (
        'C. J. Seebregts <i>et al.</i>, “The OpenMRS Implementers Network,” '
        '<i>Int. J. Med. Inform.</i>, vol. 78, no. 11, pp. 711–720, Nov. 2009, '
        'doi: 10.1016/j.ijmedinf.2008.09.005.'),
    'tierney2010': (
        'W. M. Tierney <i>et al.</i>, “Experience implementing electronic health records in '
        'three East African countries,” <i>Stud. Health Technol. Inform.</i>, vol. 160, pt. 1, '
        'pp. 371–375, 2010.'),
    'rajput2011': (
        'N. A. Mohammed-Rajput, D. C. Smith, B. Mamlin, P. Biondich, and B. N. Doebbeling, '
        '“OpenMRS, a global medical records system collaborative: factors influencing '
        'successful implementation,” in <i>AMIA Annu. Symp. Proc.</i>, 2011, pp. 960–968.'),
    'verma2021': (
        'N. Verma, B. Mamlin, J. Flowers, S. Acharya, A. Labrique, and T. Cullen, “OpenMRS as a '
        'global good: impact, opportunities, challenges, and lessons learned from fifteen years '
        'of implementation,” <i>Int. J. Med. Inform.</i>, vol. 149, Art. no. 104405, May 2021, '
        'doi: 10.1016/j.ijmedinf.2021.104405.'),
    'syzdykova2017': (
        'A. Syzdykova, A. Malta, M. Zolfo, E. Diro, and J. L. Oliveira, “Open-source electronic '
        'health record systems for low-resource settings: systematic review,” '
        '<i>JMIR Med. Inform.</i>, vol. 5, no. 4, Art. no. e44, Nov. 2017, '
        'doi: 10.2196/medinform.8131.'),
    'kiah2014': (
        'M. L. M. Kiah, A. Haiqi, B. B. Zaidan, and A. A. Zaidan, “Open source EMR software: '
        'profiling, insights and hands-on analysis,” <i>Comput. Methods Programs Biomed.</i>, '
        'vol. 117, no. 2, pp. 360–382, Nov. 2014, doi: 10.1016/j.cmpb.2014.07.002.'),
    'zaidan2015': (
        'A. A. Zaidan, B. B. Zaidan, A. Al-Haiqi, M. L. M. Kiah, M. Hussain, and M. Abdulnabi, '
        '“Evaluation and selection of open-source EMR software packages based on integrated '
        'AHP and TOPSIS,” <i>J. Biomed. Inform.</i>, vol. 53, pp. 390–404, Feb. 2015, '
        'doi: 10.1016/j.jbi.2014.11.012.'),
    'purkayastha2019': (
        'S. Purkayastha, R. Allam, P. Maity, and J. W. Gichoya, “Comparison of open-source '
        'electronic health record systems based on functional and user performance criteria,” '
        '<i>Healthc. Inform. Res.</i>, vol. 25, no. 2, pp. 89–98, Apr. 2019, '
        'doi: 10.4258/hir.2019.25.2.89.'),
    'muinga2018': (
        'N. Muinga <i>et al.</i>, “Implementing an open source electronic health record system '
        'in Kenyan health care facilities: case study,” <i>JMIR Med. Inform.</i>, vol. 6, '
        'no. 2, Art. no. e22, Apr. 2018, doi: 10.2196/medinform.8403.'),
    'jawhari2016': (
        'B. Jawhari, D. Ludwick, L. Keenan, D. Zakus, and R. Hayward, “Benefits and challenges '
        'of EMR implementations in low resource settings: a state-of-the-art review,” '
        '<i>BMC Med. Inform. Decis. Mak.</i>, vol. 16, Art. no. 116, 2016, '
        'doi: 10.1186/s12911-016-0354-8.'),
    'sandhu1996': (
        'R. S. Sandhu, E. J. Coyne, H. L. Feinstein, and C. E. Youman, “Role-based access '
        'control models,” <i>Computer</i>, vol. 29, no. 2, pp. 38–47, Feb. 1996, '
        'doi: 10.1109/2.485845.'),
    'ferraiolo2001': (
        'D. F. Ferraiolo, R. Sandhu, S. Gavrila, D. R. Kuhn, and R. Chandramouli, “Proposed NIST '
        'standard for role-based access control,” <i>ACM Trans. Inf. Syst. Secur.</i>, vol. 4, '
        'no. 3, pp. 224–274, Aug. 2001, doi: 10.1145/501978.501980.'),
    'blobel2004': (
        'B. Blobel, “Authorisation and access control for electronic health record systems,” '
        '<i>Int. J. Med. Inform.</i>, vol. 73, no. 3, pp. 251–257, Mar. 2004, '
        'doi: 10.1016/j.ijmedinf.2003.11.018.'),
    'motta2003': (
        'G. H. M. B. Motta and S. S. Furuie, “A contextual role-based access control '
        'authorization model for electronic patient record,” '
        '<i>IEEE Trans. Inf. Technol. Biomed.</i>, vol. 7, no. 3, pp. 202–207, Sep. 2003, '
        'doi: 10.1109/TITB.2003.816562.'),
    'fernandez2013': (
        'J. L. Fernández-Alemán, I. C. Señor, P. Á. O. Lozoya, and A. Toval, “Security and '
        'privacy in electronic health records: a systematic literature review,” '
        '<i>J. Biomed. Inform.</i>, vol. 46, no. 3, pp. 541–562, Jun. 2013, '
        'doi: 10.1016/j.jbi.2012.12.003.'),
    'kruse2017': (
        'C. S. Kruse, B. Smith, H. Vanderlinden, and A. Nealand, “Security techniques for the '
        'electronic health records,” <i>J. Med. Syst.</i>, vol. 41, no. 8, Art. no. 127, '
        'Aug. 2017, doi: 10.1007/s10916-017-0778-4.'),
    'carvalho2018': (
        'M. A. de Carvalho Junior and P. Bandiera-Paiva, “Health information system role-based '
        'access control current security trends and challenges,” <i>J. Healthc. Eng.</i>, '
        'vol. 2018, Art. no. 6510249, Feb. 2018, doi: 10.1155/2018/6510249.'),
    'helms2011': (
        'E. Helms and L. Williams, “Evaluating access control of open source electronic health '
        'record systems,” in <i>Proc. 3rd Workshop Softw. Eng. Health Care (SEHC)</i>, 2011, '
        'pp. 63–70, doi: 10.1145/1987993.1988006.'),
    'king2012': (
        'J. T. King, B. Smith, and L. Williams, “Modifying without a trace: general audit '
        'guidelines are inadequate for open-source electronic health record audit mechanisms,” '
        'in <i>Proc. 2nd ACM SIGHIT Int. Health Inform. Symp. (IHI)</i>, 2012, pp. 305–314, '
        'doi: 10.1145/2110363.2110399.'),
    'smith2010': (
        'B. Smith <i>et al.</i>, “Challenges for protecting the privacy of health information: '
        'required certification can leave common vulnerabilities undetected,” in <i>Proc. 2nd '
        'Annu. Workshop Secur. Privacy Med. Home-Care Syst. (SPIMACS)</i>, 2010, pp. 1–12, '
        'doi: 10.1145/1866914.1866916.'),
    'rizvi2015': (
        'S. Z. R. Rizvi, P. W. L. Fong, J. Crampton, and J. Sellwood, “Relationship-based access '
        'control for an open-source medical records system,” in <i>Proc. 20th ACM Symp. Access '
        'Control Models Technol. (SACMAT)</i>, 2015, pp. 113–124, '
        'doi: 10.1145/2752952.2752962.'),
    'rizvi2016': (
        'S. Z. R. Rizvi and P. W. L. Fong, “Interoperability of relationship- and role-based '
        'access control,” in <i>Proc. 6th ACM Conf. Data Appl. Secur. Privacy (CODASPY)</i>, '
        '2016, pp. 231–242, doi: 10.1145/2857705.2857706.'),
    'purkayastha2020': (
        'S. Purkayastha, S. Goyal, T. Phillips, H. Wu, B. Haakenson, and X. Zou, “Continuous '
        'security through integration testing in an electronic health records system,” in '
        '<i>Proc. Int. Conf. Softw. Secur. Assurance (ICSSA)</i>, 2020, pp. 26–31, '
        'doi: 10.1109/ICSSA51305.2020.00012.'),
    'elder2021': (
        'S. Elder, N. Zahan, V. Kozarev, R. Shu, T. Menzies, and L. Williams, “Structuring a '
        'comprehensive software security course around the OWASP Application Security '
        'Verification Standard,” in <i>Proc. IEEE/ACM 43rd Int. Conf. Softw. Eng.: Softw. Eng. '
        'Educ. Training (ICSE-SEET)</i>, 2021, pp. 95–104, '
        'doi: 10.1109/ICSE-SEET52601.2021.00019.'),
    'elder2022': (
        'S. Elder <i>et al.</i>, “Do I really need all this work to find vulnerabilities? An '
        'empirical case study comparing vulnerability detection techniques on a Java '
        'application,” <i>Empir. Softw. Eng.</i>, vol. 27, no. 6, Art. no. 154, 2022, '
        'doi: 10.1007/s10664-022-10179-6.'),
    'dinu2007': (
        'V. Dinu and P. Nadkarni, “Guidelines for the effective use of entity-attribute-value '
        'modeling for biomedical databases,” <i>Int. J. Med. Inform.</i>, vol. 76, no. 11–12, '
        'pp. 769–779, Nov.–Dec. 2007, doi: 10.1016/j.ijmedinf.2006.09.023.'),
    'bender2013': (
        'D. Bender and K. Sartipi, “HL7 FHIR: an agile and RESTful approach to healthcare '
        'information exchange,” in <i>Proc. 26th IEEE Int. Symp. Comput.-Based Med. Syst. '
        '(CBMS)</i>, 2013, pp. 326–331, doi: 10.1109/CBMS.2013.6627810.'),
    'mandel2016': (
        'J. C. Mandel, D. A. Kreda, K. D. Mandl, I. S. Kohane, and R. B. Ramoni, “SMART on FHIR: '
        'a standards-based, interoperable apps platform for electronic health records,” '
        '<i>J. Amer. Med. Inform. Assoc.</i>, vol. 23, no. 5, pp. 899–908, Sep. 2016, '
        'doi: 10.1093/jamia/ocv189.'),
    'kasthurirathne2015': (
        'S. N. Kasthurirathne, B. Mamlin, H. Kumara, G. Grieve, and P. Biondich, “Enabling '
        'better interoperability for healthcare: lessons in developing a standards based '
        'application programing interface for electronic medical record systems,” '
        '<i>J. Med. Syst.</i>, vol. 39, no. 11, Art. no. 182, Nov. 2015, '
        'doi: 10.1007/s10916-015-0356-6.'),

    # ------------------------------------------------------------ standards and law
    'nist800162': (
        'V. C. Hu <i>et al.</i>, “Guide to attribute based access control (ABAC) definition and '
        'considerations,” Nat. Inst. Standards Technol., Gaithersburg, MD, USA, NIST Special '
        'Publication 800-162, Jan. 2014, doi: 10.6028/NIST.SP.800-162.'),
    'hipaa': (
        'U.S. Department of Health and Human Services, “Security standards for the protection '
        'of electronic protected health information: technical safeguards,” <i>Code of Federal '
        'Regulations</i>, Title 45, Section 164.312.'),
    'dpdp2023': (
        'Government of India, <i>The Digital Personal Data Protection Act, 2023</i>, Act No. 22 '
        'of 2023, Aug. 2023.'),
    'rfc6749': (
        'D. Hardt, Ed., “The OAuth 2.0 authorization framework,” Internet Engineering Task '
        'Force, RFC 6749, Oct. 2012, doi: 10.17487/RFC6749.'),
    'rfc6238': (
        'D. M’Raihi, S. Machani, M. Pei, and J. Rydell, “TOTP: time-based one-time password '
        'algorithm,” Internet Engineering Task Force, RFC 6238, May 2011, '
        'doi: 10.17487/RFC6238.'),
    'owasp-pw': _web('OWASP Foundation', 'Password storage cheat sheet',
                     'OWASP Cheat Sheet Series',
                     'https://cheatsheetseries.owasp.org/cheatsheets/'
                     'Password_Storage_Cheat_Sheet.html'),

    # ------------------------------------------------------------ OpenMRS sources
    'core': (
        'OpenMRS, “openmrs-core: OpenMRS API and web application code,” source code repository, '
        'branches 1.4.x, 1.5.x, 2.8.x and master, and commit 2067948 of May 2, 2006. '
        + ACCESSED + ' [Online]. Available: https://github.com/openmrs/openmrs-core'),
    'schema': (
        'OpenMRS, “Liquibase schema snapshots, versions 1.9.x to 2.7.x,” in openmrs-core, '
        'branch 2.8.x, directory api/src/main/resources/org/openmrs/liquibase. ' + ACCESSED +
        ' [Online]. Available: https://github.com/openmrs/openmrs-core/tree/2.8.x/api/src/'
        'main/resources/org/openmrs/liquibase'),
    'jira': (
        'OpenMRS, “OpenMRS Trunk (TRUNK) issue tracker.” ' + ACCESSED +
        ' [Online]. Available: https://openmrs.atlassian.net/browse/TRUNK'),
    'rel27': _wiki('Platform release notes 2.7.0 (2024-12)', 'docs', '292782174'),
    'rel28': (
        'OpenMRS, “Release notes for OpenMRS Core 2.8.0 (Aug. 15, 2025) and 2.8.10 '
        '(Oct. 6, 2026),” openmrs-core releases. ' + ACCESSED +
        ' [Online]. Available: https://github.com/openmrs/openmrs-core/releases'),
    'w-tech': _wiki('Technical overview', 'docs', '25476856'),
    'w-priv': _wiki('Privilege checking for access control in OpenMRS', 'Archives', '25520917',
                    ' (archived page, 2011)'),
    'w-roles': _wiki('Controlling user access (roles and privileges)', 'docs', '25467930'),
    'w-enc': _wiki('Security and encryption', 'Archives', '25520886', ' (archived page, 2011)'),
    'w-envers': _wiki('Enabling Hibernate Envers audit logging in OpenMRS', 'docs', '113999876'),
    'w-auditweb': _wiki('Improved audit logging (GSoC 2025)', 'projects', '363757631'),
    'w-datafilter': _wiki('Data Filter', 'docs', '25476994'),
    'm-datafilter': (
        'OpenMRS, “openmrs-module-datafilter,” source code repository. ' + ACCESSED +
        ' [Online]. Available: https://github.com/openmrs/openmrs-module-datafilter'),
    'w-lbac': _wiki('Location based access control', 'projects', '26936199'),
    'm-auth': (
        'OpenMRS, “openmrs-module-authentication,” source code repository and README. '
        + ACCESSED + ' [Online]. Available: '
        'https://github.com/openmrs/openmrs-module-authentication'),
    'w-2fa': _wiki('Two-factor authentication for O3', 'docs', '1268580362'),
    'm-oauth': (
        'OpenMRS, “openmrs-module-oauth2login,” source code repository and README. '
        + ACCESSED + ' [Online]. Available: '
        'https://github.com/openmrs/openmrs-module-oauth2login'),
    'w-smart': _wiki('Using Keycloak for SMART-on-FHIR support', 'docs', '26938126'),
    'w-ncsu': _wiki('GSoC 2021: Patch security vulnerabilities identified by NCSU', 'projects',
                    '26937878'),
    'w-mbss': _wiki('Minimum baseline security standard for OpenMRS (MBSS)', 'docs',
                    '216530945'),
    'w-secconf': _wiki('Security and confidentiality', 'docs', '586383432'),
    'w-pg': _wiki('GSoC 2020: OpenMRS should run on PostgreSQL', 'projects', '26937517'),
    'w-sso': _wiki('SSO authentication and authorization', 'projects', '27009209',
                   ' (project page, 2015)'),
    'w-sysreq': _wiki('System requirements', 'Archives', '25520565', ' (archived page)'),
    'w-license': _wiki('Proposed adoption of MPL 2.0 with disclaimer', 'docs', '26312431',
                       ' (Mar. 2013)'),
    'w-rest': _wiki('REST web services API for clients', 'docs', '25469830'),
    'site': _web('OpenMRS', 'OpenMRS home page', 'openmrs.org', 'https://openmrs.org'),
    'distro': (
        'OpenMRS, “openmrs-distro-referenceapplication: the OpenMRS 3 reference application,” '
        'source code repository. ' + ACCESSED +
        ' [Online]. Available: https://github.com/openmrs/openmrs-distro-referenceapplication'),
    'esm': (
        'OpenMRS, “openmrs-esm-core: the frontend framework of OpenMRS 3,” source code '
        'repository. ' + ACCESSED +
        ' [Online]. Available: https://github.com/openmrs/openmrs-esm-core'),
    'm-rest': (
        'OpenMRS, “openmrs-module-webservices.rest,” source code repository. ' + ACCESSED +
        ' [Online]. Available: https://github.com/openmrs/openmrs-module-webservices.rest'),
    'm-fhir2': (
        'OpenMRS, “openmrs-module-fhir2,” source code repository and README. ' + ACCESSED +
        ' [Online]. Available: https://github.com/openmrs/openmrs-module-fhir2'),

    # ------------------------------------------------------------ other technical sources
    'nvd': (
        'National Institute of Standards and Technology, “National Vulnerability Database,” '
        'keyword search for “openmrs”. ' + ACCESSED +
        ' [Online]. Available: https://nvd.nist.gov/vuln/search'),
    'bishopfox': (
        'N. Serra, “OpenMRS: insecure object deserialization,” Bishop Fox security advisory for '
        'CVE-2018-19276, 2019. ' + ACCESSED + ' [Online]. Available: '
        'https://bishopfox.com/blog/openmrs-insecure-object-deserialization-advisory'),
    'ciel': _web('Digital Public Goods Alliance',
                 'Columbia International eHealth Laboratory (CIEL) concept dictionary',
                 'Digital Public Goods Registry', 'https://digitalpublicgoods.net/r/ciel-terminology'),
    'mysql': _web('Oracle Corporation', 'MySQL Community Edition', 'mysql.com',
                  'https://www.mysql.com/products/community/'),
    'mariadb': _web('MariaDB Foundation', 'About MariaDB Server', 'mariadb.org',
                    'https://mariadb.org/about/'),
    'postgres': _web('PostgreSQL Global Development Group', 'License', 'postgresql.org',
                     'https://www.postgresql.org/about/licence/'),
}
